const path = require("node:path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const protoDirectory =
    process.env.PROTO_DIR || path.resolve(__dirname, "../../../proto");

const definition = protoLoader.loadSync(
    path.join(protoDirectory, "common.proto"), {
        includeDirs: [protoDirectory],
        keepCase: true,
        longs: String,
        enums: String,
        defaults: false,
        oneofs: true
    }
);

const ecommerce = grpc.loadPackageDefinition(definition).ecommerce;

const client = new ecommerce.common.HealthService(
    process.env.AUTH_GRPC_ADDRESS || "auth-service:50051",
    grpc.credentials.createInsecure()
);

function checkAuthHealth() {
    return new Promise((resolve, reject) => {
        client.check({}, { deadline: Date.now() + 5000 }, (error, response) => {
            if (error) {
                reject(error);
                return;
            }

            if (!response || response.service !== "auth-service" || response.status !== "UP") {
                reject(new Error("Invalid Auth health response"));
                return;
            }

            resolve(response);
        });
    });
}

function closeAuthHealthClient() {
    client.close();
}

module.exports = { checkAuthHealth, closeAuthHealthClient };