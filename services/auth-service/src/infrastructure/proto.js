const path = require("node:path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const protoDirectory =
    process.env.PROTO_DIR || path.resolve(__dirname, "../../../../proto");

const definition = protoLoader.loadSync(
    [
        path.join(protoDirectory, "common.proto"),
        path.join(protoDirectory, "auth.proto")
    ], {
        includeDirs: [protoDirectory],
        keepCase: true,
        longs: String,
        enums: String,
        defaults: false,
        oneofs: true
    }
);

const ecommerce = grpc.loadPackageDefinition(definition).ecommerce;

module.exports = { grpc, ecommerce };