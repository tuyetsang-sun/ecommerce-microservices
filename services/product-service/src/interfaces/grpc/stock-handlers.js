const { timingSafeEqual } = require("node:crypto");
const { grpc } = require("../../infrastructure/proto");
const { ProductError } = require("../../domain/product-error");

function createStockHandlers({ stock, serviceToken }) {
    if (
        typeof serviceToken !== "string" ||
        !/^[0-9a-f]{64}$/i.test(serviceToken)
    ) {
        throw new Error(
            "STOCK_SERVICE_TOKEN must contain 64 hex characters"
        );
    }

    const expected = Buffer.from(serviceToken, "utf8");

    const codes = {
        VALIDATION_ERROR: grpc.status.INVALID_ARGUMENT,
        NOT_FOUND: grpc.status.NOT_FOUND,
        RESERVATION_CONFLICT: grpc.status.FAILED_PRECONDITION,
        INSUFFICIENT_STOCK: grpc.status.FAILED_PRECONDITION
    };

    function authenticate(call) {
        const values = call.metadata.get("x-stock-service-token");
        const value = values[0];

        if (
            values.length !== 1 ||
            typeof value !== "string" ||
            !/^[0-9a-f]{64}$/i.test(value) ||
            !timingSafeEqual(
                Buffer.from(value, "utf8"),
                expected
            )
        ) {
            throw {
                code: grpc.status.UNAUTHENTICATED,
                details: "Internal service authentication required"
            };
        }
    }

    function databaseError(error, operation) {
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
            event: "stock_operation_failed",
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
            try {
                authenticate(call);
            } catch (error) {
                callback(error);
                return;
            }

            if (call.cancelled) {
                callback({
                    code: grpc.status.CANCELLED,
                    details: "Request cancelled"
                });
                return;
            }

            if (Number(call.getDeadline()) <= Date.now()) {
                callback({
                    code: grpc.status.DEADLINE_EXCEEDED,
                    details: "Request deadline exceeded"
                });
                return;
            }

            let result;

            try {
                result = await stock[operation](call.request);
            } catch (error) {
                callback(databaseError(error, operation));
                return;
            }

            callback(null, result);
        };
    }

    return {
        reserveStock: handler("reserve"),
        releaseStock: handler("release"),
        confirmStock: handler("confirm")
    };
}

module.exports = { createStockHandlers };