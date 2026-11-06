const path = require("node:path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const protoDir = process.env.PROTO_DIR ||
    path.resolve(__dirname, "../../../proto");

const definition = protoLoader.loadSync(
    path.join(protoDir, "product.proto"), {
        includeDirs: [protoDir],
        keepCase: true,
        longs: String,
        enums: String,
        defaults: false,
        oneofs: true
    }
);

const { ecommerce } = grpc.loadPackageDefinition(definition);

const address = process.env.PRODUCT_GRPC_ADDRESS ||
    "product-service:50053";

const client = new ecommerce.product.ProductService(
    address,
    grpc.credentials.createInsecure()
);

const healthClient = new ecommerce.common.HealthService(
    address,
    grpc.credentials.createInsecure()
);

function callProduct(method, request, accessToken) {
    const metadata = new grpc.Metadata();

    metadata.set("authorization", "Bearer " + accessToken);

    return new Promise((resolve, reject) => {
        client[method](
            request,
            metadata, { deadline: Date.now() + 5000 },
            (error, response) => {
                if (error) return reject(error);
                resolve(response);
            }
        );
    });
}

function checkProductHealth() {
    return new Promise((resolve, reject) => {
        healthClient.check({}, { deadline: Date.now() + 5000 },
            (error, response) => {
                if (error) return reject(error);

                if (!response ||
                    response.service !== "product-service" ||
                    response.status !== "UP"
                ) {
                    return reject(
                        new Error("Invalid Product health response")
                    );
                }

                resolve(response);
            }
        );
    });
}

function closeProductClients() {
    client.close();
    healthClient.close();
}

module.exports = {
    callProduct,
    checkProductHealth,
    closeProductClients
};