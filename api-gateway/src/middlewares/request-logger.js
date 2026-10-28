const { randomUUID } = require("node:crypto");

function requestLogger(req, res, next) {
    const startedAt = Date.now();

    req.requestId = randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    const requestPath = req.path;

    res.on("finish", () => {
        console.log(JSON.stringify({
            event: "http_request",
            requestId: req.requestId,
            method: req.method,
            path: requestPath,
            statusCode: res.statusCode,
            durationMs: Date.now() - startedAt
        }));
    });

    next();
}

module.exports = { requestLogger };