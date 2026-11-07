class InvalidOrderEvent extends Error {}

function normalizeOrderEvent(value) {
    const validInt = n =>
        Number.isInteger(n) && n > 0 && n <= 2147483647;

    const invalid = () => {
        throw new InvalidOrderEvent("Invalid order-created payload");
    };

    if (!value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        value.event_type !== "order-created" ||
        !validInt(value.oid) ||
        !validInt(value.uid) ||
        typeof value.event_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.event_id) ||
        !Array.isArray(value.items) ||
        value.items.length < 1 ||
        value.items.length > 100
    ) {
        invalid();
    }

    const seen = new Set();

    const items = value.items.map(item => {
        if (!item ||
            !validInt(item.pid) ||
            !validInt(item.qty) ||
            seen.has(item.pid) ||
            typeof item.unit_price !== "string" ||
            !/^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/.test(item.unit_price) ||
            BigInt(item.unit_price.replace(".", "")) <= BigInt(0)
        ) {
            invalid();
        }

        seen.add(item.pid);

        return {
            pid: item.pid,
            qty: item.qty,
            unit_price: item.unit_price
        };
    }).sort((a, b) => a.pid - b.pid);

    return {
        event_id: value.event_id.toLowerCase(),
        oid: value.oid,
        uid: value.uid,
        items
    };
}

module.exports = {
    InvalidOrderEvent,
    normalizeOrderEvent
};