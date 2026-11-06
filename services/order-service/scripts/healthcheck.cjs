const {
    grpc,
    ecommerce
} = require("../src/infrastructure/proto");

const client = new ecommerce.common.HealthService(
    "127.0.0.1:" + (process.env.GRPC_PORT || 50054),
    grpc.credentials.createInsecure()
);

client.check({}, { deadline: Date.now() + 5000 },
    (error, response) => {
        client.close();

        if (
            error ||
            !response ||
            response.service !== "order-service" ||
            response.status !== "UP"
        ) {
            console.error(
                "HEALTH CHECK FAILED: order-service"
            );

            process.exitCode = 1;
            return;
        }

        console.log(
            "HEALTH CHECK PASSED: order-service UP"
        );
    }
);