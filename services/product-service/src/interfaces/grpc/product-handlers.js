const { grpc } = require("../../infrastructure/proto");
const { ProductError } = require("../../domain/product-error");

const codes = {
    VALIDATION_ERROR: grpc.status.INVALID_ARGUMENT,
    NOT_FOUND: grpc.status.NOT_FOUND,
    FORBIDDEN: grpc.status.PERMISSION_DENIED,
    UNAUTHENTICATED: grpc.status.UNAUTHENTICATED,
    AUTH_UNAVAILABLE: grpc.status.UNAVAILABLE,
    AUTH_TIMEOUT: grpc.status.DEADLINE_EXCEEDED,
    ID_EXHAUSTED: grpc.status.RESOURCE_EXHAUSTED,
    CANCELLED: grpc.status.CANCELLED
};

function createProductHandlers({ app, verifyToken }) {
    async function authenticate(call) {
        const headers = call.metadata.get("authorization");
        const header = headers[0];

        const match =
            typeof header === "string" && header.length <= 8192 ?
            /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(header) :
            null;

        if (headers.length !== 1 || !match) {
            throw new ProductError(
                "UNAUTHENTICATED",
                "Bearer token is required"
            );
        }

        const deadline = new Date(
            Math.min(Date.now() + 3000, Number(call.getDeadline()))
        );

        const user = await verifyToken(match[1], deadline);
        const expiresAt = Number(user && user.expires_at);

        if (!user ||
            !Number.isInteger(user.uid) ||
            user.uid < 1 ||
            user.uid > 2147483647 ||
            !["normal", "admin"].includes(user.role) ||
            !Number.isSafeInteger(expiresAt)
        ) {
            throw new ProductError(
                "AUTH_UNAVAILABLE",
                "Invalid authentication service response"
            );
        }

        if (expiresAt <= Math.floor(Date.now() / 1000)) {
            throw new ProductError(
                "UNAUTHENTICATED",
                "Invalid or expired token"
            );
        }

        return Object.freeze({
            uid: user.uid,
            role: user.role
        });
    }

    function toGrpcError(error, operation) {
        if (
            error instanceof ProductError &&
            codes[error.code] !== undefined
        ) {
            return {
                code: codes[error.code],
                details: error.message
            };
        }

        console.error(JSON.stringify({
            event: "product_operation_failed",
            operation,
            code: error.code || error.name || "UNKNOWN"
        }));

        if ([
                "MongoNetworkError",
                "MongoNetworkTimeoutError",
                "MongoServerSelectionError",
                "MongoNotConnectedError"
            ].includes(error.name)) {
            return {
                code: grpc.status.UNAVAILABLE,
                details: "Product database unavailable"
            };
        }

        if (error.name === "MongoOperationTimeoutError") {
            return {
                code: grpc.status.DEADLINE_EXCEEDED,
                details: "Product database timed out"
            };
        }

        return {
            code: grpc.status.INTERNAL,
            details: "Internal server error"
        };
    }

    function handler(operation) {
        return async(call, callback) => {
            let result;

            try {
                const actor = await authenticate(call);

                if (call.cancelled) {
                    throw new ProductError(
                        "CANCELLED",
                        "Request cancelled"
                    );
                }

                result = operation === "listProducts" ?
                    { items: await app.listProducts(actor) } :
                    await app[operation](call.request, actor);
            } catch (error) {
                callback(toGrpcError(error, operation));
                return;
            }

            callback(null, result);
        };
    }

    return {
        listProducts: handler("listProducts"),
        getProduct: handler("getProduct"),
        createProduct: handler("createProduct"),
        updateProduct: handler("updateProduct"),
        deleteProduct: handler("deleteProduct")
    };
}

module.exports = { createProductHandlers };