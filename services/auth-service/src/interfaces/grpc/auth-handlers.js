const { grpc } = require("../../infrastructure/proto");
const { AuthError } = require("../../domain/auth-error");

const businessCodes = {
    VALIDATION_ERROR: grpc.status.INVALID_ARGUMENT,
    CONFLICT: grpc.status.ALREADY_EXISTS,
    UNAUTHENTICATED: grpc.status.UNAUTHENTICATED
};

function createAuthHandlers(auth) {
    function handler(operation) {
        return async(call, callback) => {
            let result;

            try {
                result = await auth[operation](call.request);
            } catch (error) {
                const businessCode = error instanceof AuthError ?
                    businessCodes[error.code] :
                    undefined;

                if (businessCode !== undefined) {
                    callback({
                        code: businessCode,
                        details: error.message
                    });
                    return;
                }

                const code = String(error.code || "UNKNOWN");

                const unavailable = code.startsWith("08") || [
                    "ECONNREFUSED",
                    "ECONNRESET",
                    "ETIMEDOUT",
                    "ENOTFOUND",
                    "EAI_AGAIN",
                    "57P01",
                    "57P02",
                    "57P03",
                    "53300"
                ].includes(code);

                console.error(JSON.stringify({
                    event: "auth_operation_failed",
                    operation,
                    code
                }));

                callback({
                    code: unavailable ?
                        grpc.status.UNAVAILABLE :
                        grpc.status.INTERNAL,
                    details: unavailable ?
                        "Auth service temporarily unavailable" :
                        "Internal server error"
                });

                return;
            }

            callback(null, result);
        };
    }

    return {
        register: handler("register"),
        login: handler("login"),
        verifyToken: handler("verifyToken")
    };
}

module.exports = { createAuthHandlers };