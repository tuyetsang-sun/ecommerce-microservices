const { CustomerError } = require("./customer-error");

function fail(code, message) {
    throw new CustomerError(code, message);
}

function object(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        fail("VALIDATION_ERROR", "Request must be an object");
    }

    return value;
}

function has(input, field) {
    return Object.prototype.hasOwnProperty.call(input, field) &&
        input[field] !== undefined;
}

function positiveId(value, field) {
    if (!Number.isInteger(value) ||
        value < 1 ||
        value > 2147483647
    ) {
        fail("VALIDATION_ERROR", `${field} must be a positive int32`);
    }

    return value;
}

function text(value, field, maxLength) {
    if (typeof value !== "string") {
        fail("VALIDATION_ERROR", `${field} must be a string`);
    }

    const normalized = value.trim();

    if (!normalized ||
        normalized.length > maxLength ||
        normalized.includes("\0")
    ) {
        fail(
            "VALIDATION_ERROR",
            `${field} must contain 1 to ${maxLength} characters`
        );
    }

    return normalized;
}

function initialFullname(value) {
    if (value === undefined || value === null) return null;

    if (typeof value === "string" && value.trim() === "") {
        return null;
    }

    return text(value, "fullname", 100);
}

function score(value) {
    if (!Number.isInteger(value) ||
        value < 0 ||
        value > 2147483647
    ) {
        fail("VALIDATION_ERROR", "score must be a nonnegative int32");
    }

    return value;
}

function requireActor(actor) {
    if (!actor ||
        !Number.isInteger(actor.uid) ||
        actor.uid < 1 ||
        actor.uid > 2147483647 ||
        !["normal", "admin"].includes(actor.role)
    ) {
        fail("UNAUTHENTICATED", "Authentication is required");
    }

    return actor;
}

function requireAdmin(actor) {
    requireActor(actor);

    if (actor.role !== "admin") {
        fail("FORBIDDEN", "Administrator permission is required");
    }
}

function requireOwnerOrAdmin(actor, uid) {
    requireActor(actor);

    if (actor.role !== "admin" && actor.uid !== uid) {
        fail(
            "FORBIDDEN",
            "You cannot access another customer's profile"
        );
    }
}

module.exports = {
    fail,
    object,
    has,
    positiveId,
    text,
    initialFullname,
    score,
    requireActor,
    requireAdmin,
    requireOwnerOrAdmin
};