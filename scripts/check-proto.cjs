const fs = require("node:fs");
const path = require("node:path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const protoDirectory = path.resolve(__dirname, "../proto");

const filenames = [
    "common.proto",
    "auth.proto",
    "customer.proto",
    "product.proto",
    "order.proto",
    "shipment.proto",
];

const expectedServices = [
    ["common", "HealthService"],
    ["auth", "AuthService"],
    ["customer", "CustomerService"],
    ["product", "ProductService"],
    ["order", "OrderService"],
    ["shipment", "ShipmentService"],
];

try {
    const files = filenames.map((filename) => {
        const fullPath = path.join(protoDirectory, filename);

        if (!fs.existsSync(fullPath)) {
            throw new Error(`Missing file: ${filename}`);
        }

        return fullPath;
    });

    const definition = protoLoader.loadSync(files, {
        includeDirs: [protoDirectory],
        keepCase: true,
        longs: String,
        enums: String,
        defaults: false,
        oneofs: true,
    });

    const loaded = grpc.loadPackageDefinition(definition);
    const ecommerce = loaded.ecommerce;

    if (!ecommerce) {
        throw new Error("Missing ecommerce package");
    }

    for (const [namespace, serviceName] of expectedServices) {
        const namespaceObject = ecommerce[namespace];
        const Service = namespaceObject && namespaceObject[serviceName];

        if (!Service || !Service.service) {
            throw new Error(`Missing service: ${namespace}.${serviceName}`);
        }

        const methods = Object.values(Service.service);

        if (methods.length === 0) {
            throw new Error(`Service has no RPC: ${serviceName}`);
        }

        console.log(
            `[OK] ${namespace}.${serviceName} (${methods.length} RPC)`
        );
    }

    console.log(
        "PROTO CHECK PASSED: 6 files, 6 service interfaces."
    );
} catch (error) {
    console.error("PROTO CHECK FAILED:", error.message);
    process.exitCode = 1;
}