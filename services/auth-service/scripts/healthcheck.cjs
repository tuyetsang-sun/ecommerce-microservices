const { grpc, ecommerce } = require("../src/infrastructure/proto");

const target =
    process.argv[2] || "127.0.0.1:" + (process.env.GRPC_PORT || "50051");

const client = new ecommerce.common.HealthService(
    target,
    grpc.credentials.createInsecure()
);

client.check({}, { deadline: Date.now() + 5000 },
    (error, response) => {
        client.close();

        if (error) {
            console.error("HEALTH CHECK FAILED:", error.code, error.details);
            process.exitCode = 1;
            return;
        }

        if (!response || response.service !== "auth-service" || response.status !== "UP") {
            console.error("HEALTH CHECK FAILED: Unexpected response");
            process.exitCode = 1;
            return;
        }

        console.log("HEALTH CHECK PASSED: auth-service UP");
    }
);