const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomBytes } = require("node:crypto");
const { setTimeout: pause } = require("node:timers/promises");

const { pool } = require("../src/infrastructure/db");
const { grpc, ecommerce } = require("../src/infrastructure/proto");

const fixturePath = "/tmp/customer-provisioning-check.json";

const auth = new ecommerce.auth.AuthService(
    process.env.AUTH_GRPC_ADDRESS || "auth-service:50051",
    grpc.credentials.createInsecure()
);

const customer = new ecommerce.customer.CustomerService(
    process.env.CUSTOMER_GRPC_ADDRESS || "customer-service:50052",
    grpc.credentials.createInsecure()
);

function rpc(client, method, input, metadata = new grpc.Metadata()) {
    return new Promise((resolve, reject) => {
        client[method](
            input,
            metadata, { deadline: new Date(Date.now() + 5000) },
            (error, result) => {
                if (error) reject(error);
                else resolve(result);
            }
        );
    });
}

async function main() {
    try {
        const mode = process.argv[2];

        if (mode === "start") {
            if (fs.existsSync(fixturePath)) {
                throw new Error(
                    "Run verify for the existing fixture first"
                );
            }

            const fixture = {
                username: "p3prov_" + randomBytes(6).toString("hex"),
                password: randomBytes(16).toString("hex"),
                fullname: "Provisioning Test"
            };

            const registered = await rpc(
                auth,
                "register",
                fixture
            );

            fixture.uid = registered.uid;

            fs.writeFileSync(
                fixturePath,
                JSON.stringify(fixture), { mode: 0o600 }
            );

            const result = await pool.query(
                `SELECT processed_at
         FROM public.customer_provisioning
         WHERE uid = $1`, [fixture.uid]
            );

            assert.equal(result.rowCount, 1);
            assert.equal(result.rows[0].processed_at, null);

            console.log(
                `PENDING CHECK PASSED: uid=${fixture.uid}, username=${fixture.username}`
            );

            return;
        }

        if (mode !== "verify") {
            throw new Error("Use start or verify");
        }

        const fixture = JSON.parse(
            fs.readFileSync(fixturePath, "utf8")
        );

        const login = await rpc(auth, "login", {
            username: fixture.username,
            password: fixture.password
        });

        const metadata = new grpc.Metadata();

        metadata.set(
            "authorization",
            `Bearer ${login.access_token}`
        );

        const deadline = Date.now() + 90000;

        while (Date.now() < deadline) {
            const result = await pool.query(
                `SELECT processed_at, attempts
         FROM public.customer_provisioning
         WHERE uid = $1`, [fixture.uid]
            );

            assert.equal(result.rowCount, 1);

            if (result.rows[0].processed_at !== null) {
                const profile = await rpc(
                    customer,
                    "getCustomer", { uid: fixture.uid },
                    metadata
                );

                assert.equal(profile.uid, fixture.uid);
                assert.equal(profile.fullname, fixture.fullname);
                assert.equal(profile.mid, 1);
                assert.ok(result.rows[0].attempts >= 1);

                fs.unlinkSync(fixturePath);

                console.log(
                    `PROVISIONING E2E CHECK PASSED: uid=${fixture.uid}, attempts=${result.rows[0].attempts}`
                );

                return;
            }

            await pause(1000);
        }

        throw new Error(
            "Provisioning did not finish within 90 seconds"
        );
    } finally {
        auth.close();
        customer.close();
        await pool.end();
    }
}

main().catch(error => {
    console.error(
        "PROVISIONING CHECK FAILED:",
        error.message
    );

    process.exitCode = 1;
});