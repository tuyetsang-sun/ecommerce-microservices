const { ProductError } = require("./product-error");

function fail(code, message) {
    throw new ProductError(code, message);
}

function object(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        fail("VALIDATION_ERROR", "Request must be an object");
    }
}

function integer(value, min, field) {
    if (!Number.isInteger(value) ||
        value < min ||
        value > 2147483647
    ) {
        fail(
            "VALIDATION_ERROR",
            field + " is outside the allowed integer range"
        );
    }

    return value;
}

function productName(value) {
    if (
        typeof value !== "string" ||
        !value.trim() ||
        value.trim().length > 120 ||
        value.includes("\u0000")
    ) {
        fail(
            "VALIDATION_ERROR",
            "pname must contain 1 to 120 characters"
        );
    }

    return value.trim();
}

function price(value) {
    if (typeof value !== "string") {
        fail("VALIDATION_ERROR", "price must be a decimal string");
    }

    const match =
        /^(0|[1-9][0-9]{0,11})(?:\.([0-9]{1,2}))?$/.exec(value.trim());

    if (!match) {
        fail(
            "VALIDATION_ERROR",
            "price allows 12 integer digits and 2 decimal places"
        );
    }

    const fraction = (match[2] || "").padEnd(2, "0");

    const cents = BigInt(match[1]) * BigInt(100) + BigInt(fraction);

    if (cents <= BigInt(0)) {
        fail("VALIDATION_ERROR", "price must be greater than zero");
    }

    return match[1] + "." + fraction;
}

function requireActor(actor) {
    if (!actor ||
        !Number.isInteger(actor.uid) ||
        actor.uid < 1 ||
        actor.uid > 2147483647 ||
        !["normal", "admin"].includes(actor.role)
    ) {
        fail("UNAUTHENTICATED", "Verified identity is required");
    }
}

function requireAdmin(actor) {
    requireActor(actor);

    if (actor.role !== "admin") {
        fail("FORBIDDEN", "Admin role is required");
    }
}

function productInput(input, creating) {
    object(input);

    const result = {};

    if (creating || Object.hasOwn(input, "pname")) {
        result.pname = productName(input.pname);
    }

    if (creating || Object.hasOwn(input, "price")) {
        result.price = price(input.price);
    }

    if (creating || Object.hasOwn(input, "quantity")) {
        result.quantity = integer(input.quantity, 0, "quantity");
    }

    if (Object.keys(result).length === 0) {
        fail("VALIDATION_ERROR", "No supported fields to update");
    }

    return result;
}

module.exports = {
    fail,
    object,
    integer,
    price,
    productInput,
    requireActor,
    requireAdmin
};