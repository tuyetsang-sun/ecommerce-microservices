const path = require("node:path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const protoDir = process.env.PROTO_DIR ||
    path.resolve(__dirname, "../../../../proto");

const definition = protoLoader.loadSync(
    [
        "common.proto",
        "order.proto",
        "auth.proto",
        "customer.proto",
        "product.proto"
    ].map(
        name => path.join(protoDir, name)
    ), {
        includeDirs: [protoDir],
        keepCase: true,
        longs: String,
        enums: String,
        defaults: false,
        oneofs: true
    }
);

const { ecommerce } = grpc.loadPackageDefinition(definition);

module.exports = { grpc, ecommerce };