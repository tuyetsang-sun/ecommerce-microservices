const express = require("express");

const { authRouter } = require("./routes/auth");
const { healthRouter } = require("./routes/health");
const { createCustomerRouter } = require("./routes/customers");
const { createMembershipRouter } = require("./routes/memberships");
const {
    errorHandler
} = require("./middlewares/error-handler");

const {
    requestLogger
} = require("./middlewares/request-logger");

const {
    callAuth,
    closeAuthClient
} = require("./clients/auth");

const {
    closeAuthHealthClient
} = require("./clients/auth-health");

const {
    callCustomer,
    closeCustomerClients
} = require("./clients/customer");

const {
    connectRedis,
    closeRedis
} = require("./clients/redis");

const app = express();
const port = Number(process.env.PORT || 3000);

app.set("trust proxy", false);
app.disable("x-powered-by");
app.disable("etag");

app.use(requestLogger);
app.use(healthRouter);
app.use("/api/auth", authRouter);

app.use(
    "/api/customers",
    createCustomerRouter({
        verifyToken: accessToken =>
            callAuth("verifyToken", {
                access_token: accessToken
            }),
        callCustomer
    })
);
app.use(
    "/api/memberships",
    createMembershipRouter({
        verifyToken: accessToken =>
            callAuth("verifyToken", {
                access_token: accessToken
            }),
        callCustomer
    })
);
app.use((req, res) => {
    res.status(404).json({
        message: "Route not found",
        requestId: req.requestId
    });
});

app.use(errorHandler);

connectRedis().catch(() => {
    console.error(JSON.stringify({
        event: "redis_connection_failed"
    }));
});

const server = app.listen(port, "0.0.0.0", () => {
    console.log(
        "[api-gateway] HTTP listening on port " + port
    );
});

server.on("error", error => {
    console.error(
        "[api-gateway] Startup failed:",
        error.code
    );

    process.exit(1);
});

let stopping = false;

function closeClients() {
    closeAuthHealthClient();
    closeAuthClient();
    closeCustomerClients();
    closeRedis();
}

function shutdown() {
    if (stopping) return;
    stopping = true;

    const timer = setTimeout(() => {
        server.closeAllConnections();
        closeClients();
        process.exit(1);
    }, 8000);

    server.close(() => {
        closeClients();
        clearTimeout(timer);
    });
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);