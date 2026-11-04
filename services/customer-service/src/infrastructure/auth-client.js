const { grpc, ecommerce } = require("./proto");
const { CustomerError } = require("../domain/customer-error");

function createAuthClient(address) {
    const client = new ecommerce.auth.AuthService(
        address,
        grpc.credentials.createInsecure()
    );

    function verifyToken(accessToken, deadline) {
        return new Promise((resolve, reject) => {
            client.verifyToken({ access_token: accessToken }, { deadline },
                (error, user) => {
                    if (!error) return resolve(user);

                    if (error.code === grpc.status.UNAUTHENTICATED) {
                        return reject(
                            new CustomerError(
                                "UNAUTHENTICATED",
                                "Invalid or expired token"
                            )
                        );
                    }

                    if (error.code === grpc.status.DEADLINE_EXCEEDED) {
                        return reject(
                            new CustomerError(
                                "AUTH_TIMEOUT",
                                "Authentication service timed out"
                            )
                        );
                    }

                    reject(
                        new CustomerError(
                            "AUTH_UNAVAILABLE",
                            "Authentication service unavailable"
                        )
                    );
                }
            );
        });
    }

    return {
        verifyToken,
        close: () => client.close()
    };
}

module.exports = { createAuthClient };