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
    process.env.SHIPMENT_GRPC_ADDRESS || "shipment-service:50055",
    grpc.credentials.createInsecure()
);

function checkShipmentHealth() {
    return new Promise((resolve, reject) => {
        client.check({}, { deadline: Date.now() + 5000 }, (error, response) => {
            if (error) {
                reject(error);
                return;
            }

            if (!response || response.service !== "shipment-service" || response.status !== "UP") {
                reject(new Error("Invalid Shipment health response"));
                return;
            }

            resolve(response);
        });
    });
}

function closeShipmentHealthClient() {
    client.close();
}

module.exports = { checkShipmentHealth, closeShipmentHealthClient };