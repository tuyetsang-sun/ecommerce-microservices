const { OrderError } = require("./order-error");
const { normalizeItems } = require("./order-rules");

function decimalUnits(value, digits, code) {
    const match =
        typeof value === "string" && value.length <= digits + 3 ?
        /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/.exec(value) :
        null;

    if (!match || match[1].length > digits) {
        throw new OrderError(code, "Invalid decimal value");
    }

    return BigInt(match[1]) * BigInt(100) +
        BigInt((match[2] || "").padEnd(2, "0"));
}

function formatUnits(value) {
    return (value / BigInt(100)).toString() + "." +
        (value % BigInt(100)).toString().padStart(2, "0");
}

function calculateOrderAmounts(
    requestedItems,
    reservedItems,
    discountRate
) {
    const items = normalizeItems(requestedItems);

    const rate = decimalUnits(
        discountRate,
        3,
        "INVALID_DISCOUNT_RATE"
    );

    if (rate > BigInt(10000)) {
        throw new OrderError(
            "INVALID_DISCOUNT_RATE",
            "Discount rate must be between 0 and 100"
        );
    }

    function invalidProduct() {
        throw new OrderError(
            "INVALID_PRODUCT_RESPONSE",
            "Product reservation does not match order"
        );
    }

    if (!Array.isArray(reservedItems) ||
        reservedItems.length !== items.length
    ) {
        invalidProduct();
    }

    const prices = new Map();

    for (const row of reservedItems) {
        if (!row ||
            typeof row !== "object" ||
            prices.has(row.pid)
        ) {
            invalidProduct();
        }

        prices.set(row.pid, row);
    }

    let subtotal = BigInt(0);

    const details = items.map(item => {
        const row = prices.get(item.pid);

        if (!row || row.qty !== item.qty) {
            invalidProduct();
        }

        const price = decimalUnits(
            row.unit_price,
            12,
            "INVALID_PRODUCT_RESPONSE"
        );

        if (price <= BigInt(0)) {
            invalidProduct();
        }

        subtotal += price * BigInt(item.qty);

        return {
            pid: item.pid,
            qty: item.qty,
            unit_price: formatUnits(price)
        };
    });

    if (subtotal > BigInt(10) ** BigInt(28) - BigInt(1)) {
        throw new OrderError(
            "ORDER_TOO_LARGE",
            "Order amount exceeds database capacity"
        );
    }

    // Làm tròn tiền giảm về 2 chữ số thập phân.
    const discount = (subtotal * rate + BigInt(5000)) / BigInt(10000);

    return {
        items: details,
        subtotal: formatUnits(subtotal),
        discount_rate: formatUnits(rate),
        discount_amount: formatUnits(discount),
        total_amount: formatUnits(subtotal - discount)
    };
}

module.exports = { calculateOrderAmounts };