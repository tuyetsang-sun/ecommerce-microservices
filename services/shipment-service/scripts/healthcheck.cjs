const { grpc, ecommerce } = require("../src/infrastructure/proto");

const client = new ecommerce.common.HealthService(
    "127.0.0.1:" + (process.env.GRPC_PORT || 50055),
    grpc.credentials.createInsecure()
);

client.check({}, { deadline: Date.now() + 5000 },
    (error, response) => {
        client.close();

        if (error || !response ||
            response.service !== "shipment-service" ||
            response.status !== "UP") {
            console.error("HEALTH CHECK FAILED: shipment-service");
            process.exitCode = 1;
            return;
        }

        console.log("HEALTH CHECK PASSED: shipment-service UP");
    }
);