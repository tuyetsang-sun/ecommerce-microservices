const path = require("node:path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const protoDir =
    process.env.PROTO_DIR ||
    path.resolve(__dirname, "../../../proto");

const definition = protoLoader.loadSync(
    path.join(protoDir, "customer.proto"), {
        includeDirs: [protoDir],
        keepCase: true,
        longs: String,
        enums: String,
        defaults: false,
        oneofs: true
    }
);

const { ecommerce } = grpc.loadPackageDefinition(definition);

const address =
    process.env.CUSTOMER_GRPC_ADDRESS ||
    "customer-service:50052";

const client = new ecommerce.customer.CustomerService(
    address,
    grpc.credentials.createInsecure()
);

const healthClient = new ecommerce.common.HealthService(
    address,
    grpc.credentials.createInsecure()
);

function callCustomer(method, request, accessToken) {
    const metadata = new grpc.Metadata();

    metadata.set(
        "authorization",
        `Bearer ${accessToken}`
    );

    return new Promise((resolve, reject) => {
        client[method](
            request,
            metadata, { deadline: Date.now() + 5000 },
            (error, response) => {
                if (error) reject(error);
                else resolve(response);
            }
        );
    });
}

function checkCustomerHealth() {
    return new Promise((resolve, reject) => {
        healthClient.check({}, { deadline: Date.now() + 5000 },
            (error, response) => {
                if (error) return reject(error);

                if (!response ||
                    response.service !== "customer-service" ||
                    response.status !== "UP"
                ) {
                    return reject(
                        new Error("Invalid Customer health response")
                    );
                }

                resolve(response);
            }
        );
    });
}

function closeCustomerClients() {
    client.close();
    healthClient.close();
}

module.exports = {
    callCustomer,
    checkCustomerHealth,
    closeCustomerClients
};