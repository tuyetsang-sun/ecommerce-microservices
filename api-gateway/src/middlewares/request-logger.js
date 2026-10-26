const { randomUUID } = require("node:crypto");

function requestLogger(req, res, next) {
    const startedAt = Date.now();

    req.requestId = randomUUID();
    res.setHeader("X-Request-Id", req.requestId);

    res.on("finish", () => {
        console.log(JSON.stringify({
            event: "http_request",
            requestId: req.requestId,
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            durationMs: Date.now() - startedAt
        }));
    });

    next();
}

module.exports = { requestLogger };