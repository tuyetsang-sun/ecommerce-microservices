const { client, db } = require("../../infrastructure/db");
const { grpc, ecommerce } = require("../../infrastructure/proto");
const { createAuthClient } = require("../../infrastructure/auth-client");
const { createProductRepository } = require("../../infrastructure/product-repository");
const { createProductUseCases } = require("../../application/product-use-cases");
const { createProductHandlers } = require("./product-handlers");
const port = Number(process.env.GRPC_PORT || 50053);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid GRPC_PORT");
}

const server = new grpc.Server();
let stopping = false;
const authClient = createAuthClient(
    process.env.AUTH_GRPC_ADDRESS || "auth-service:50051"
);

const app = createProductUseCases({
    products: createProductRepository(db)
});

server.addService(
    ecommerce.product.ProductService.service,
    createProductHandlers({
        app,
        verifyToken: authClient.verifyToken
    })
);
server.addService(ecommerce.common.HealthService.service, {
    check: async(call, callback) => {
        if (stopping) {
            return callback({
                code: grpc.status.UNAVAILABLE,
                details: "Product service is stopping"
            });
        }

        try {
            const result = await db.command({ ping: 1 }, { timeoutMS: 3000 });

            if (result.ok !== 1) {
                throw new Error("Unexpected ping result");
            }
        } catch (error) {
            console.error(JSON.stringify({
                event: "product_health_failed",
                code: error.code || error.name || "DATABASE_ERROR"
            }));

            return callback({
                code: grpc.status.UNAVAILABLE,
                details: "Product database unavailable"
            });
        }

        callback(null, {
            service: "product-service",
            status: "UP"
        });
    }
});

function shutdown(exitCode = 0) {
    if (stopping) return;
    stopping = true;

    const timer = setTimeout(() => {
        server.forceShutdown();
        process.exit(1);
    }, 8000);

    server.tryShutdown(() => {
        authClient.close();
        client.close()
            .then(() => {
                clearTimeout(timer);
                process.exit(exitCode);
            })
            .catch(() => process.exit(1));
    });
}

process.once("SIGTERM", () => shutdown());
process.once("SIGINT", () => shutdown());

server.bindAsync(
    "0.0.0.0:" + port,
    grpc.ServerCredentials.createInsecure(),
    error => {
        if (error) {
            console.error(
                "[product-service] Failed to bind gRPC server"
            );

            shutdown(1);
            return;
        }

        console.log(
            "[product-service] gRPC listening on port " + port
        );
    }
);