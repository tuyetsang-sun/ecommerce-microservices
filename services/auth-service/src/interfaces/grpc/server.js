const { grpc, ecommerce } = require("../../infrastructure/proto");
const { pool } = require("../../infrastructure/db");

const server = new grpc.Server();
const port = process.env.GRPC_PORT || "50051";

server.addService(ecommerce.common.HealthService.service, {
    async check(call, callback) {
        try {
            await pool.query("SELECT 1");

            callback(null, {
                service: "auth-service",
                status: "UP"
            });
        } catch (error) {
            console.error("[health] Database check failed:", error.code || "UNKNOWN");

            callback({
                code: grpc.status.UNAVAILABLE,
                details: "Auth database unavailable"
            });
        }
    }
});

server.bindAsync(
    "0.0.0.0:" + port,
    grpc.ServerCredentials.createInsecure(),
    (error, boundPort) => {
        if (error) {
            console.error("[auth-service] Startup failed:", error.message);
            process.exit(1);
        }

        console.log("[auth-service] gRPC listening on port " + boundPort);
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

    server.tryShutdown(async() => {
        try {
            await pool.end();
        } catch (error) {
            console.error("[auth-service] Shutdown failed:", error.code || "UNKNOWN");
            process.exitCode = 1;
        } finally {
            clearTimeout(timer);
        }
    });
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);