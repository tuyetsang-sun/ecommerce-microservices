const fs = require("node:fs");
const { setTimeout: pause } = require("node:timers/promises");

const { pool } = require("../../infrastructure/db");

const {
    createProvisioningRepository
} = require("../../infrastructure/provisioning-repository");

const {
    createCustomerClient
} = require("../../infrastructure/customer-client");

const {
    createCustomerProvisioner
} = require("../../application/provision-customer");

const heartbeat = "/tmp/auth-provisioner-heartbeat";

fs.rmSync(heartbeat, { force: true });

const customer = createCustomerClient(
    process.env.CUSTOMER_GRPC_ADDRESS || "customer-service:50052",
    process.env.CUSTOMER_PROVISIONING_SECRET
);

const provisioner = createCustomerProvisioner({
    jobs: createProvisioningRepository(pool),
    ensureCustomer: customer.ensureCustomer
});

let stopping = false;
let shutdownTimer;

function shutdown() {
    if (stopping) return;

    stopping = true;
    shutdownTimer = setTimeout(() => process.exit(1), 8000);
    shutdownTimer.unref();
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

async function main() {
    console.log("[auth-provisioner] started");

    try {
        while (!stopping) {
            let waitMs = 1000;

            try {
                const result = await provisioner.runOnce();

                fs.writeFileSync(heartbeat, "OK\n");

                if (result.status !== "idle") {
                    console.log(JSON.stringify({
                        event: "customer_provisioning",
                        ...result
                    }));

                    waitMs = 0;
                }
            } catch (error) {
                console.error(JSON.stringify({
                    event: "customer_provisioning_failed",
                    code: String(error.code || "UNKNOWN")
                }));
            }

            if (!stopping && waitMs > 0) {
                await pause(waitMs);
            }
        }
    } finally {
        customer.close();
        await pool.end();

        clearTimeout(shutdownTimer);
        fs.rmSync(heartbeat, { force: true });
    }
}

main().catch(error => {
    console.error(
        "[auth-provisioner] stopped:",
        error.code || "UNKNOWN"
    );

    process.exitCode = 1;
});