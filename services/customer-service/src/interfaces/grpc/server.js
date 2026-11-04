const { pool } = require("../../infrastructure/db");
const { grpc, ecommerce } = require("../../infrastructure/proto");

const {
    createAuthClient
} = require("../../infrastructure/auth-client");

const {
    createCustomerRepositories
} = require("../../infrastructure/customer-repositories");

const {
    createCustomerUseCases
} = require("../../application/customer-use-cases");

const {
    createCustomerHandlers
} = require("./customer-handlers");

const authClient = createAuthClient(
    process.env.AUTH_GRPC_ADDRESS || "auth-service:50051"
);

const app = createCustomerUseCases(
    createCustomerRepositories(pool)
);

const customerHandlers = createCustomerHandlers({
    app,
    verifyToken: authClient.verifyToken,
    provisioningSecret: process.env.CUSTOMER_PROVISIONING_SECRET
});

const server = new grpc.Server();

server.addService(
    ecommerce.customer.CustomerService.service,
    customerHandlers
);

server.addService(ecommerce.common.HealthService.service, {
    check: async(call, callback) => {
        try {
            await pool.query(`
        SELECT c.uid, c.fullname, c.mid, m.mname, m.score
        FROM public.customers c
        JOIN public.memberships m ON m.mid = c.mid
        LIMIT 0
      `);

            callback(null, {
                service: "customer-service",
                status: "UP"
            });
        } catch (error) {
            console.error(JSON.stringify({
                event: "customer_health_failed",
                code: error.code || "DATABASE_ERROR"
            }));

            callback({
                code: grpc.status.UNAVAILABLE,
                details: "Customer database unavailable"
            });
        }
    }
});

const port = Number(process.env.GRPC_PORT || 50052);

server.bindAsync(
    `0.0.0.0:${port}`,
    grpc.ServerCredentials.createInsecure(),
    error => {
        if (error) {
            console.error("[customer-service] Failed to bind gRPC server");

            server.forceShutdown();
            authClient.close();
            pool.end().finally(() => process.exit(1));
            return;
        }

        console.log(
            `[customer-service] gRPC listening on port ${port}`
        );
    }
);

let stopping = false;

function shutdown() {
    if (stopping) return;
    stopping = true;

    const timer = setTimeout(() => {
        server.forceShutdown();
        process.exit(1);
    }, 8000);

    server.tryShutdown(() => {
        authClient.close();

        pool.end()
            .then(() => {
                clearTimeout(timer);
                process.exit(0);
            })
            .catch(() => process.exit(1));
    });
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);