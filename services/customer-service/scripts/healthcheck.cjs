const {
    grpc,
    ecommerce
} = require("../src/infrastructure/proto");

const port = process.env.GRPC_PORT || 50052;

const client = new ecommerce.common.HealthService(
    `127.0.0.1:${port}`,
    grpc.credentials.createInsecure()
);

client.check({}, { deadline: new Date(Date.now() + 5000) },
    (error, response) => {
        client.close();

        if (
            error ||
            !response ||
            response.service !== "customer-service" ||
            response.status !== "UP"
        ) {
            console.error("HEALTH CHECK FAILED: customer-service");
            process.exitCode = 1;
            return;
        }

        console.log("HEALTH CHECK PASSED: customer-service UP");
    }
);