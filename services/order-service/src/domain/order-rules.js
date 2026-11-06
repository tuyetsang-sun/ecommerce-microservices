const { createHash } = require("node:crypto");
const { OrderError } = require("./order-error");

function invalid(message) {
    throw new OrderError("VALIDATION_ERROR", message);
}

function isObject(value) {
    return value !== null &&
        typeof value === "object" &&
        !Array.isArray(value);
}

function positiveInt32(value) {
    return Number.isInteger(value) &&
        value > 0 &&
        value <= 2147483647;
}

function normalizeItems(items) {
    if (!Array.isArray(items) ||
        items.length < 1 ||
        items.length > 100
    ) {
        invalid("Order must contain 1 to 100 product lines");
    }

    const seen = new Set();

    const result = items.map(item => {
        if (!isObject(item) ||
            Object.keys(item).some(
                key => !["pid", "qty"].includes(key)
            ) ||
            !positiveInt32(item.pid) ||
            !positiveInt32(item.qty)
        ) {
            invalid("Each item requires positive int32 pid and qty only");
        }

        if (seen.has(item.pid)) {
            invalid("Duplicate product in order");
        }

        seen.add(item.pid);

        return {
            pid: item.pid,
            qty: item.qty
        };
    });

    return result.sort((a, b) => a.pid - b.pid);
}

function normalizeCreateOrder(input) {
    if (!isObject(input) ||
        Object.keys(input).some(
            key => !["items", "idempotency_key"].includes(key)
        )
    ) {
        invalid("Send items and idempotency_key only");
    }

    if (
        typeof input.idempotency_key !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(
            input.idempotency_key
        )
    ) {
        invalid(
            "idempotency_key must contain 1 to 128 valid ASCII characters"
        );
    }

    const items = normalizeItems(input.items);

    const requestHash = createHash("sha256")
        .update(JSON.stringify({ version: 1, items }))
        .digest("hex");

    return {
        items,
        idempotency_key: input.idempotency_key,
        request_hash: requestHash
    };
}

module.exports = {
    normalizeItems,
    normalizeCreateOrder
};