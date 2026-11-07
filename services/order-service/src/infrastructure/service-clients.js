const { grpc, ecommerce } = require("./proto");

function createServiceClients() {
    const secret = process.env.STOCK_SERVICE_TOKEN;

    if (!/^[0-9a-f]{64}$/i.test(secret || "")) {
        throw new Error("Invalid STOCK_SERVICE_TOKEN");
    }

    const credentials = grpc.credentials.createInsecure();

    const auth = new ecommerce.auth.AuthService(
        process.env.AUTH_GRPC_ADDRESS || "auth-service:50051",
        credentials
    );

    const customer = new ecommerce.customer.CustomerService(
        process.env.CUSTOMER_GRPC_ADDRESS || "customer-service:50052",
        credentials
    );

    const product = new ecommerce.product.ProductService(
        process.env.PRODUCT_GRPC_ADDRESS || "product-service:50053",
        credentials
    );

    function rpc(client, method, data, token, internal = false) {
        const metadata = new grpc.Metadata();

        if (internal) {
            metadata.set("x-stock-service-token", secret);
        } else if (token) {
            metadata.set("authorization", "Bearer " + token);
        }

        return new Promise((resolve, reject) => {
            client[method](
                data,
                metadata, {
                    deadline: Date.now() + (internal ? 35000 : 5000)
                },
                (error, result) => {
                    if (error) return reject(error);
                    resolve(result);
                }
            );
        });
    }

    return {
        verifyToken: token =>
            rpc(auth, "verifyToken", { access_token: token }),

        getMembership: (uid, token) =>
            rpc(customer, "getMembership", { uid }, token),

        reserveStock: data =>
            rpc(product, "reserveStock", data, null, true),

        releaseStock: data =>
            rpc(product, "releaseStock", data, null, true),

        confirmStock: data =>
            rpc(product, "confirmStock", data, null, true),

        close: () => {
            auth.close();
            customer.close();
            product.close();
        }
    };
}

module.exports = { createServiceClients };