const path = require("node:path");
const grpc = require("@grpc/grpc-js");
const loader = require("@grpc/proto-loader");

const dir = process.env.PROTO_DIR ||
    path.resolve(__dirname, "../../../proto");

const definition = loader.loadSync(
    path.join(dir, "order.proto"), {
        includeDirs: [dir],
        keepCase: true,
        longs: String,
        enums: String,
        defaults: false,
        oneofs: true
    }
);

const { ecommerce } = grpc.loadPackageDefinition(definition);

const address = process.env.ORDER_GRPC_ADDRESS ||
    "order-service:50054";

const client = new ecommerce.order.OrderService(
    address,
    grpc.credentials.createInsecure()
);

const health = new ecommerce.common.HealthService(
    address,
    grpc.credentials.createInsecure()
);

function invoke(target, method, input, metadata, timeout) {
    return new Promise((resolve, reject) => {
        target[method](
            input,
            metadata, { deadline: Date.now() + timeout },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );
    });
}

function callOrder(method, input, token) {
    const metadata = new grpc.Metadata();
    metadata.set("authorization", "Bearer " + token);

    return invoke(
        client,
        method,
        input,
        metadata,
        method === "createOrder" ? 90000 : 5000
    );
}

async function checkOrderHealth() {
    const result = await invoke(
        health,
        "check", {},
        new grpc.Metadata(),
        5000
    );

    if (!result ||
        result.service !== "order-service" ||
        result.status !== "UP"
    ) {
        throw new Error("Invalid Order health response");
    }

    return result;
}

function closeOrderClients() {
    client.close();
    health.close();
}

module.exports = {
    callOrder,
    checkOrderHealth,
    closeOrderClients
};