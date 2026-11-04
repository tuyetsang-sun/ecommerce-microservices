const { timingSafeEqual } = require("node:crypto");
const { grpc } = require("../../infrastructure/proto");
const { CustomerError } = require("../../domain/customer-error");

const codes = new Map([
    ["VALIDATION_ERROR", grpc.status.INVALID_ARGUMENT],
    ["NOT_FOUND", grpc.status.NOT_FOUND],
    ["CONFLICT", grpc.status.ALREADY_EXISTS],
    ["FORBIDDEN", grpc.status.PERMISSION_DENIED],
    ["UNAUTHENTICATED", grpc.status.UNAUTHENTICATED],
    ["AUTH_UNAVAILABLE", grpc.status.UNAVAILABLE],
    ["AUTH_TIMEOUT", grpc.status.DEADLINE_EXCEEDED],
    ["CANCELLED", grpc.status.CANCELLED]
]);

function createCustomerHandlers({
    app,
    verifyToken,
    provisioningSecret,
    logger = console
}) {
    if (!/^[a-f0-9]{64}$/.test(provisioningSecret || "")) {
        throw new Error(
            "CUSTOMER_PROVISIONING_SECRET must contain 64 lowercase hex characters"
        );
    }

    const expectedKey = Buffer.from(provisioningSecret, "hex");

    function requireProvisioner(metadata) {
        const values = metadata.get("x-provisioning-key");
        const key = values[0];

        if (
            values.length !== 1 ||
            typeof key !== "string" ||
            !/^[a-f0-9]{64}$/.test(key) ||
            !timingSafeEqual(Buffer.from(key, "hex"), expectedKey)
        ) {
            throw new CustomerError(
                "UNAUTHENTICATED",
                "Service authentication required"
            );
        }
    }

    async function authenticate(call) {
        const values = call.metadata.get("authorization");
        const header = values[0];

        const match =
            typeof header === "string" &&
            header.length <= 8192 &&
            /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(
                header
            );

        if (values.length !== 1 || !match) {
            throw new CustomerError(
                "UNAUTHENTICATED",
                "Bearer token required"
            );
        }

        const deadline = new Date(
            Math.min(
                Date.now() + 3000,
                Number(call.getDeadline())
            )
        );

        const user = await verifyToken(match[1], deadline);

        if (!user ||
            !Number.isInteger(user.uid) ||
            user.uid < 1 ||
            user.uid > 2147483647 ||
            !["normal", "admin"].includes(user.role)
        ) {
            throw new CustomerError(
                "AUTH_UNAVAILABLE",
                "Invalid authentication service response"
            );
        }

        return Object.freeze({
            uid: user.uid,
            role: user.role
        });
    }

    function toGrpcError(error, operation) {
        if (
            error instanceof CustomerError &&
            codes.has(error.code)
        ) {
            return {
                code: codes.get(error.code),
                details: error.message
            };
        }

        const code = String(error.code || "UNKNOWN");

        const unavailable =
            code.startsWith("08") || [
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

        logger.error(JSON.stringify({
            event: "customer_operation_failed",
            operation,
            code
        }));

        return {
            code: unavailable ?
                grpc.status.UNAVAILABLE :
                grpc.status.INTERNAL,
            details: unavailable ?
                "Customer database unavailable" :
                "Internal server error"
        };
    }

    function handler(operation, internal = false) {
        return async(call, callback) => {
            let result;

            try {
                let actor;

                if (internal) {
                    requireProvisioner(call.metadata);
                } else {
                    actor = await authenticate(call);
                }

                if (call.cancelled) {
                    throw new CustomerError(
                        "CANCELLED",
                        "Request cancelled"
                    );
                }

                if (operation === "listMemberships") {
                    result = {
                        items: await app.listMemberships(actor)
                    };
                } else {
                    result = await app[operation](
                        call.request,
                        actor
                    );
                }

                if (
                    [
                        "ensureCustomer",
                        "getCustomer",
                        "updateCustomer"
                    ].includes(operation)
                ) {
                    result = {
                        uid: result.uid,
                        fullname: result.fullname === null ?
                            "" :
                            result.fullname,
                        mid: result.mid
                    };
                }
            } catch (error) {
                callback(toGrpcError(error, operation));
                return;
            }

            callback(null, result);
        };
    }

    return {
        ensureCustomer: handler("ensureCustomer", true),
        getCustomer: handler("getCustomer"),
        updateCustomer: handler("updateCustomer"),
        getMembership: handler("getMembership"),
        listMemberships: handler("listMemberships"),
        createMembership: handler("createMembership"),
        updateMembership: handler("updateMembership")
    };
}

module.exports = { createCustomerHandlers };