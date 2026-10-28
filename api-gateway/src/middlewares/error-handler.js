const grpc = require("@grpc/grpc-js");

class HttpError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.name = "HttpError";
        this.statusCode = statusCode;
    }
}

const grpcErrors = new Map([
    [grpc.status.INVALID_ARGUMENT, [400, "Invalid request"]],
    [grpc.status.ALREADY_EXISTS, [409, "Username or email already exists"]],
    [grpc.status.UNAUTHENTICATED, [401, "Authentication failed"]],
    [grpc.status.PERMISSION_DENIED, [403, "Forbidden"]],
    [grpc.status.NOT_FOUND, [404, "Resource not found"]],
    [grpc.status.UNAVAILABLE, [503, "Authentication service unavailable"]],
    [grpc.status.DEADLINE_EXCEEDED, [504, "Authentication service timed out"]]
]);

function errorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);

    let statusCode = 500;
    let message = "Internal server error";

    if (error instanceof HttpError) {
        statusCode = error.statusCode;
        message = error.message;
    } else if (error.type === "entity.parse.failed") {
        statusCode = 400;
        message = "Invalid JSON body";
    } else if (error.type === "entity.too.large") {
        statusCode = 413;
        message = "Request body exceeds 16 KB";
    } else if (
        ["charset.unsupported", "encoding.unsupported"].includes(error.type)
    ) {
        statusCode = 415;
        message = "Unsupported request encoding";
    } else if (
        ["request.aborted", "request.size.invalid"].includes(error.type)
    ) {
        statusCode = 400;
        message = "Incomplete or invalid request body";
    } else if (grpcErrors.has(error.code)) {
        [statusCode, message] = grpcErrors.get(error.code);

        if (
            error.code === grpc.status.INVALID_ARGUMENT &&
            error.details
        ) {
            message = error.details;
        }
    }

    if (statusCode >= 500) {
        console.error(JSON.stringify({
            event: "http_error",
            requestId: req.requestId,
            statusCode,
            code: error.code || error.type || "INTERNAL"
        }));
    }

    res.status(statusCode).json({
        message,
        requestId: req.requestId
    });
}

module.exports = { HttpError, errorHandler };