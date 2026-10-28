const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");

const { grpc, ecommerce } = require("../src/infrastructure/proto");
const { pool } = require("../src/infrastructure/db");
const { verifyPassword } = require("../src/infrastructure/security/password");
const { createUserRepository } = require("../src/infrastructure/user-repository");

const client = new ecommerce.auth.AuthService(
    "127.0.0.1:" + (process.env.GRPC_PORT || "50051"),
    grpc.credentials.createInsecure()
);

const base = "grpc_" + randomBytes(8).toString("hex");

const names = [
    base,
    base + "_other",
    base + "_race",
    base + "_rollback"
];

const account = {
    username: base,
    password: "P@ss123",
    email: base + "@example.test",
    fullname: "Auth integration test"
};

function rpc(method, request) {
    return new Promise((resolve, reject) => {
        client[method](
            request, { deadline: Date.now() + 15000 },
            (error, response) => {
                if (error) reject(error);
                else resolve(response);
            }
        );
    });
}

function expectCode(promise, code) {
    return assert.rejects(promise, error => error.code === code);
}

async function main() {
    try {
        const registered = await rpc("register", account);

        assert.ok(
            Number.isInteger(registered.uid) && registered.uid > 0
        );

        assert.equal(
            registered.message,
            "User registered successfully"
        );

        const saved = await pool.query(
            `SELECT u.password_hash, r.rolename, p.fullname, p.processed_at
       FROM public.users u
       JOIN public.roles r ON r.roleid = u.roleid
       JOIN public.customer_provisioning p ON p.uid = u.uid
       WHERE u.uid = $1`, [registered.uid]
        );

        assert.equal(saved.rows.length, 1);
        assert.equal(saved.rows[0].rolename, "normal");
        assert.equal(saved.rows[0].fullname, account.fullname);
        assert.equal(saved.rows[0].processed_at, null);
        assert.notEqual(saved.rows[0].password_hash, account.password);

        assert.equal(
            await verifyPassword(account.password, saved.rows[0].password_hash),
            true
        );

        console.log(
            "OK: Register persists a bcrypt hash, normal role and profile request"
        );

        await expectCode(
            rpc("register", {
                ...account,
                username: base.toUpperCase(),
                email: base + "_new@example.test"
            }),
            grpc.status.ALREADY_EXISTS
        );

        await expectCode(
            rpc("register", {
                ...account,
                username: names[1],
                email: account.email.toUpperCase()
            }),
            grpc.status.ALREADY_EXISTS
        );

        console.log(
            "OK: Duplicate username and email return ALREADY_EXISTS"
        );

        await expectCode(
            rpc("register", { username: names[1] }),
            grpc.status.INVALID_ARGUMENT
        );

        await expectCode(
            rpc("login", { username: base }),
            grpc.status.INVALID_ARGUMENT
        );

        console.log(
            "OK: Missing password returns INVALID_ARGUMENT"
        );

        await expectCode(
            rpc("login", {
                username: base,
                password: "wrong"
            }),
            grpc.status.UNAUTHENTICATED
        );

        await expectCode(
            rpc("login", {
                username: names[1],
                password: account.password
            }),
            grpc.status.UNAUTHENTICATED
        );

        const login = await rpc("login", {
            username: base.toUpperCase(),
            password: account.password
        });

        assert.equal(login.token_type, "Bearer");
        assert.equal(login.expires_in, 3600);

        const identity = await rpc("verifyToken", {
            access_token: login.access_token
        });

        assert.equal(identity.uid, registered.uid);
        assert.equal(identity.role, "normal");

        assert.ok(
            Number(identity.expires_at) > Math.floor(Date.now() / 1000)
        );

        const parts = login.access_token.split(".");

        const payload = JSON.parse(
            Buffer.from(parts[1], "base64url").toString("utf8")
        );

        payload.role = "admin";

        parts[1] = Buffer.from(
            JSON.stringify(payload)
        ).toString("base64url");

        await expectCode(
            rpc("verifyToken", { access_token: parts.join(".") }),
            grpc.status.UNAUTHENTICATED
        );

        await expectCode(
            rpc("verifyToken", {}),
            grpc.status.UNAUTHENTICATED
        );

        console.log(
            "OK: Login, JWT verification and authentication failures"
        );

        const racing = {
            ...account,
            username: names[2],
            email: names[2] + "@example.test"
        };

        const outcomes = await Promise.allSettled([
            rpc("register", racing),
            rpc("register", racing)
        ]);

        assert.equal(
            outcomes.filter(item => item.status === "fulfilled").length,
            1
        );

        const rejected = outcomes.filter(
            item => item.status === "rejected"
        );

        assert.equal(rejected.length, 1);
        assert.equal(
            rejected[0].reason.code,
            grpc.status.ALREADY_EXISTS
        );

        const raced = await pool.query(
            `SELECT u.uid FROM public.users u
       JOIN public.customer_provisioning p ON p.uid = u.uid
       WHERE u.username = $1`, [names[2]]
        );

        assert.equal(raced.rows.length, 1);

        console.log(
            "OK: Concurrent duplicate registration creates one account"
        );

        // Cố ý bỏ qua validation để kiểm tra rollback tại repository.
        await assert.rejects(
            createUserRepository(pool).createNormalUser({
                username: names[3],
                passwordHash: saved.rows[0].password_hash,
                email: null,
                phone: null,
                fullname: "x".repeat(101)
            }),
            error => error.code === "22001"
        );

        const rolledBack = await pool.query(
            "SELECT uid FROM public.users WHERE username = $1", [names[3]]
        );

        assert.equal(rolledBack.rows.length, 0);

        console.log(
            "OK: Profile insert failure rolls back the account insert"
        );
    } finally {
        client.close();

        try {
            await pool.query(
                "DELETE FROM public.users WHERE lower(username) = ANY($1::text[])", [names]
            );
        } finally {
            await pool.end();
        }
    }
}

main().then(() => {
    console.log(
        "AUTH GRPC CHECK PASSED (test accounts cleaned up)"
    );
}).catch(error => {
    console.error(
        "AUTH GRPC CHECK FAILED:",
        error.code || error.name,
        error.message
    );

    process.exitCode = 1;
});