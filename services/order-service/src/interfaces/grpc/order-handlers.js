const { grpc } = require("../../infrastructure/proto");
const { OrderError } = require("../../domain/order-error");

function createOrderHandlers({ app, remote }) {
    function handler(operation) {
        return async(call, callback) => {
            try {
                const values = call.metadata.get("authorization");
                const header = values[0];

                const match =
                    typeof header === "string" &&
                    header.length <= 8192 ?
                    /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(header) :
                    null;

                if (values.length !== 1 || !match) {
                    callback({
                        code: 16,
                        details: "Bearer token is required"
                    });
                    return;
                }

                const token = match[1];
                const actor = await remote.verifyToken(token);

                if (!actor ||
                    !Number.isInteger(actor.uid) ||
                    actor.uid < 1 ||
                    actor.uid > 2147483647 ||
                    !["normal", "admin"].includes(actor.role) ||
                    !Number.isSafeInteger(Number(actor.expires_at)) ||
                    Number(actor.expires_at) <=
                    Math.floor(Date.now() / 1000)
                ) {
                    callback({
                        code: 16,
                        details: "Invalid or expired token"
                    });
                    return;
                }

                if (call.cancelled) {
                    callback({
                        code: 1,
                        details: "Request cancelled"
                    });
                    return;
                }

                const result = operation === "list" ?
                    await app.list(actor) :
                    await app[operation](call.request, actor, token);

                callback(null, result);
            } catch (error) {
                if (
                    error instanceof OrderError &&
                    error.code === "VALIDATION_ERROR"
                ) {
                    callback({
                        code: 3,
                        details: error.message
                    });
                    return;
                }

                if ([3, 5, 9, 16, 7, 14, 4].includes(error.code)) {
                    callback({
                        code: error.code,
                        details: error.details || "Order operation failed"
                    });
                    return;
                }

                console.error(JSON.stringify({
                    event: "order_operation_failed",
                    code: error.code || "INTERNAL"
                }));

                callback({
                    code: grpc.status.UNAVAILABLE,
                    details: "Order unavailable; retry with the same Idempotency-Key"
                });
            }
        };
    }

    return {
        createOrder: handler("create"),
        listOrders: handler("list"),
        getOrder: handler("get")
    };
}

module.exports = { createOrderHandlers };