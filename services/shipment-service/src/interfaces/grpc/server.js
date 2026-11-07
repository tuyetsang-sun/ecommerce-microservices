const { client, db } = require("../../infrastructure/db");
const { grpc, ecommerce } = require("../../infrastructure/proto");

const {
    initializeShipmentDatabase,
    createShipmentRepository
} = require("../../infrastructure/shipment-repository");

const {
    createReceiveOrder
} = require("../../application/receive-order");

const {
    createOrderConsumer
} = require("../events/order-consumer");

const port = Number(process.env.GRPC_PORT || 50055);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid GRPC_PORT");
}

const server = new grpc.Server();
let stopping = false;

const consumer = createOrderConsumer({
    db,
    receiveOrder: createReceiveOrder(
        createShipmentRepository(db)
    ),
    onFatal: () => shutdown(1)
});

server.addService(ecommerce.common.HealthService.service, {
    check: async(call, callback) => {
        try {
            if (stopping || !consumer.isReady()) {
                throw new Error("Consumer unavailable");
            }

            await db.command({ ping: 1 }, { timeoutMS: 3000 });

            callback(null, {
                service: "shipment-service",
                status: "UP"
            });
        } catch {
            callback({
                code: grpc.status.UNAVAILABLE,
                details: "Shipment dependency unavailable"
            });
        }
    }
});

function shutdown(code = 0) {
    if (stopping) return;
    stopping = true;

    const timer = setTimeout(() => {
        server.forceShutdown();
        process.exit(1);
    }, 15000);

    server.tryShutdown(async() => {
        try {
            await consumer.stop();
            await client.close();

            clearTimeout(timer);
            process.exit(code);
        } catch {
            process.exit(1);
        }
    });
}

async function main() {
    await client.connect();
    await initializeShipmentDatabase(db);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            "0.0.0.0:" + port,
            grpc.ServerCredentials.createInsecure(),
            error => {
                if (error) return reject(error);
                resolve();
            }
        );
    });

    await consumer.start();

    console.log(
        "[shipment-service] gRPC " + port +
        "; consuming order-created"
    );
}

process.once("SIGTERM", () => shutdown());
process.once("SIGINT", () => shutdown());

main().catch(error => {
    console.error(JSON.stringify({
        event: "shipment_start_failed",
        code: error.code || error.name
    }));

    shutdown(1);
});