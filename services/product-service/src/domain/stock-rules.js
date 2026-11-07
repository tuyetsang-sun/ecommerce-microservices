const { createHash } = require("node:crypto");
const rules = require("./product-rules");

function fields(value, allowed) {
    rules.object(value);

    if (Object.keys(value).some(key => !allowed.includes(key))) {
        rules.fail(
            "VALIDATION_ERROR",
            "Unexpected stock request field"
        );
    }
}

function reservationId(value) {
    if (
        typeof value !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ) {
        rules.fail(
            "VALIDATION_ERROR",
            "reservation_id must be a UUID v4"
        );
    }

    return value.toLowerCase();
}

function normalizeReserveStock(input) {
    fields(input, ["reservation_id", "items"]);

    const id = reservationId(input.reservation_id);

    if (!Array.isArray(input.items) ||
        input.items.length < 1 ||
        input.items.length > 100
    ) {
        rules.fail(
            "VALIDATION_ERROR",
            "Stock request requires 1 to 100 items"
        );
    }

    const seen = new Set();

    const items = input.items.map(item => {
        fields(item, ["pid", "qty"]);

        const pid = rules.integer(item.pid, 1, "pid");
        const qty = rules.integer(item.qty, 1, "qty");

        if (seen.has(pid)) {
            rules.fail(
                "VALIDATION_ERROR",
                "Duplicate product in stock request"
            );
        }

        seen.add(pid);

        return { pid, qty };
    }).sort((a, b) => a.pid - b.pid);

    const requestHash = createHash("sha256")
        .update(JSON.stringify({ version: 1, items }))
        .digest("hex");

    return {
        reservation_id: id,
        items,
        request_hash: requestHash
    };
}

function normalizeReleaseStock(input) {
    fields(input, ["reservation_id"]);

    return {
        reservation_id: reservationId(input.reservation_id)
    };
}

module.exports = {
    normalizeReserveStock,
    normalizeReleaseStock
};