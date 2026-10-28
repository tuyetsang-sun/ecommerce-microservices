const path = require("node:path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const protoDirectory =
    process.env.PROTO_DIR ||
    path.resolve(__dirname, "../../../proto");

const definition = protoLoader.loadSync(
    path.join(protoDirectory, "auth.proto"), {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: false,
        oneofs: true,
        includeDirs: [protoDirectory]
    }
);

const authPackage =
    grpc.loadPackageDefinition(definition).ecommerce.auth;

const client = new authPackage.AuthService(
    process.env.AUTH_GRPC_ADDRESS || "auth-service:50051",
    grpc.credentials.createInsecure()
);

function callAuth(method, request) {
    return new Promise((resolve, reject) => {
        client[method](
            request, { deadline: Date.now() + 10000 },
            (error, response) => {
                if (error) reject(error);
                else resolve(response);
            }
        );
    });
}

function closeAuthClient() {
    client.close();
}

module.exports = { callAuth, closeAuthClient };