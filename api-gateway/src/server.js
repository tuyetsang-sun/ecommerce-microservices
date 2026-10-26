const express = require("express");
const { requestLogger } = require("./middlewares/request-logger");
const healthRoutes = require("./routes/health");
const { closeAuthHealthClient } = require("./clients/auth-health");

const app = express();
const port = Number(process.env.PORT || 3000);

app.disable("x-powered-by");
app.disable("etag");

app.use(requestLogger);
app.use(healthRoutes);

app.use((req, res) => {
    res.status(404).json({
        message: "Route not found",
        requestId: req.requestId
    });
});

app.use((error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }

    console.error(JSON.stringify({
        event: "http_error",
        requestId: req.requestId,
        code: error.code || "UNKNOWN"
    }));

    res.status(500).json({
        message: "Internal server error",
        requestId: req.requestId
    });
});

const server = app.listen(port, "0.0.0.0", () => {
    console.log("[api-gateway] HTTP listening on port " + port);
});

server.on("error", (error) => {
    console.error("[api-gateway] Startup failed:", error.code);
    process.exit(1);
});

let stopping = false;

function shutdown() {
    if (stopping) return;
    stopping = true;

    const timer = setTimeout(() => {
        server.closeAllConnections();
        closeAuthHealthClient();
        process.exit(1);
    }, 8000);

    server.close(() => {
        closeAuthHealthClient();
        clearTimeout(timer);
    });
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);