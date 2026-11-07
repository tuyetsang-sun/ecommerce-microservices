const {
    createServiceClients
} = require("../../infrastructure/service-clients");

const {
    createOrderUseCases
} = require("../../application/order-use-cases");

const {
    createOrderHandlers
} = require("./order-handlers");
const { pool } = require("../../infrastructure/db");
const { grpc, ecommerce } = require("../../infrastructure/proto");

const port = Number(process.env.GRPC_PORT || 50054);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid GRPC_PORT");
}

const server = new grpc.Server();
let stopping = false;
const remote = createServiceClients();
const app = createOrderUseCases({ pool, remote });

server.addService(
    ecommerce.order.OrderService.service,
    createOrderHandlers({ app, remote })
);

const stopRecovery = app.startRecovery();
server.addService(ecommerce.common.HealthService.service, {
    check: async(call, callback) => {
        if (stopping) {
            return callback({
                code: grpc.status.UNAVAILABLE,
                details: "Order service is stopping"
            });
        }

        try {
            await pool.query(
                "SELECT reservation_id FROM order_requests LIMIT 0"
            );
            await pool.query(`
                SELECT o.oid, d.pid, e.event_id
                FROM public.orders o
                LEFT JOIN public.order_details d ON d.oid = o.oid
                LEFT JOIN public.order_outbox e ON e.oid = o.oid
                LIMIT 0
            `);
            const result = await pool.query("SELECT 1 AS ok");

            if (!result.rows[0] || result.rows[0].ok !== 1) {
                throw new Error("Unexpected database response");
            }
        } catch (error) {
            console.error(JSON.stringify({
                event: "order_health_failed",
                code: error.code || "DATABASE_ERROR"
            }));

            return callback({
                code: grpc.status.UNAVAILABLE,
                details: "Order database unavailable"
            });
        }

        callback(null, {
            service: "order-service",
            status: "UP"
        });
    }
});

function shutdown(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    stopRecovery();
    const timer = setTimeout(() => {
        server.forceShutdown();
        process.exit(1);
    }, 8000);

    server.tryShutdown(() => {
        remote.close();
        pool.end()
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
                "[order-service] Failed to bind gRPC server"
            );

            shutdown(1);
            return;
        }

        console.log(
            "[order-service] gRPC listening on port " + port
        );
    }
);