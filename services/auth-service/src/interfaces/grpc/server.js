const { grpc, ecommerce } = require("../../infrastructure/proto");
const { pool } = require("../../infrastructure/db");
const { createUserRepository } = require("../../infrastructure/user-repository");
const passwords = require("../../infrastructure/security/password");

const {
    createTokenService,
    ACCESS_TOKEN_TTL_SECONDS
} = require("../../infrastructure/security/tokens");

const { createAuthUseCases } = require("../../application/auth-use-cases");
const { createAuthHandlers } = require("./auth-handlers");

const auth = createAuthUseCases({
    users: createUserRepository(pool),
    passwords,
    tokens: createTokenService({
        secret: process.env.AUTH_JWT_SECRET
    }),
    expiresIn: ACCESS_TOKEN_TTL_SECONDS
});

const server = new grpc.Server();
const port = process.env.GRPC_PORT || "50051";

server.addService(
    ecommerce.auth.AuthService.service,
    createAuthHandlers(auth)
);

server.addService(ecommerce.common.HealthService.service, {
    async check(call, callback) {
        try {
            await pool.query(`
        SELECT u.uid, r.rolename, p.uid AS provisioning_uid
        FROM public.users AS u
        JOIN public.roles AS r ON r.roleid = u.roleid
        LEFT JOIN public.customer_provisioning AS p ON p.uid = u.uid
        LIMIT 0
      `);

            callback(null, {
                service: "auth-service",
                status: "UP"
            });
        } catch (error) {
            console.error(
                "[health] Database check failed:",
                error.code || "UNKNOWN"
            );

            callback({
                code: grpc.status.UNAVAILABLE,
                details: "Auth database unavailable"
            });
        }
    }
});

server.bindAsync(
    "0.0.0.0:" + port,
    grpc.ServerCredentials.createInsecure(),
    (error, boundPort) => {
        if (error) {
            console.error("[auth-service] Startup failed:", error.message);
            process.exit(1);
        }

        console.log(
            "[auth-service] gRPC listening on port " + boundPort
        );
    }
);

let stopping = false;

function shutdown() {
    if (stopping) return;
    stopping = true;

    const timer = setTimeout(() => {
        server.forceShutdown();
        process.exit(1);
    }, 8000);

    server.tryShutdown(async() => {
        try {
            await pool.end();
        } catch (error) {
            console.error(
                "[auth-service] Shutdown failed:",
                error.code || "UNKNOWN"
            );
            process.exitCode = 1;
        } finally {
            clearTimeout(timer);
        }
    });
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);