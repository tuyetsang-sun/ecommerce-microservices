const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
    normalizeItems,
    normalizeCreateOrder
} = require("../src/domain/order-rules");

const {
    calculateOrderAmounts
} = require("../src/domain/order-pricing");

const items = [{ pid: 1, qty: 2 }];

const reserved = [
    { pid: 1, qty: 2, unit_price: "100.00" }
];

test("1. Normalize items and produce a stable request hash", () => {
    const input = {
        items: [{ pid: 2, qty: 1 }, ...items],
        idempotency_key: "demo-001"
    };

    const first = normalizeCreateOrder(input);

    const second = normalizeCreateOrder({
        ...input,
        items: [...input.items].reverse()
    });

    assert.deepEqual(first.items, [
        { pid: 1, qty: 2 },
        { pid: 2, qty: 1 }
    ]);

    assert.equal(first.request_hash, second.request_hash);
    assert.match(first.request_hash, /^[0-9a-f]{64}$/);
    assert.equal(input.items[0].pid, 2);

    const changed = normalizeCreateOrder({
        ...input,
        items: [{ pid: 1, qty: 3 }]
    });

    assert.notEqual(first.request_hash, changed.request_hash);
});

test("2. Reject empty, duplicated and invalid order lines", () => {
    for (const value of[
            [],
            null, [null], [{ pid: 1, qty: 0 }], [{ pid: 0, qty: 1 }], [{ pid: 1, qty: 1.5 }], [{ pid: 1, qty: "2" }], [{ pid: 2147483648, qty: 1 }], [...items, ...items], [{ pid: 1, qty: 2, price: 1 }],
            Array.from({ length: 101 },
                (_, i) => ({ pid: i + 1, qty: 1 })
            )
        ]) {
        assert.throws(
            () => normalizeItems(value), { code: "VALIDATION_ERROR" }
        );
    }
});

test("3. Reject invalid keys and client-supplied totals or identity", () => {
    for (const key of[
            undefined, "", " ", "a b", "a".repeat(129), 123
        ]) {
        assert.throws(
            () => normalizeCreateOrder({
                items,
                idempotency_key: key
            }), { code: "VALIDATION_ERROR" }
        );
    }

    for (const field of[
            "uid", "score", "discount", "total_amount"
        ]) {
        assert.throws(
            () => normalizeCreateOrder({
                items,
                idempotency_key: "demo",
                [field]: 1
            }), { code: "VALIDATION_ERROR" }
        );
    }
});

test("4. Two products at 100 with 10 percent discount cost 180", () => {
    assert.deepEqual(
        calculateOrderAmounts(items, reserved, "10"), {
            items: reserved,
            subtotal: "200.00",
            discount_rate: "10.00",
            discount_amount: "20.00",
            total_amount: "180.00"
        }
    );
});

test("5. Decimal prices are calculated exactly", () => {
    const result = calculateOrderAmounts(
        [{ pid: 1, qty: 3 }, { pid: 2, qty: 1 }], [
            { pid: 2, qty: 1, unit_price: "0.20" },
            { pid: 1, qty: 3, unit_price: "0.10" }
        ],
        "0"
    );

    assert.equal(result.subtotal, "0.50");
    assert.equal(result.total_amount, "0.50");
});

test("6. Half-cent discount rounds up", () => {
    const result = calculateOrderAmounts(
        [{ pid: 1, qty: 1 }], [{ pid: 1, qty: 1, unit_price: "0.05" }],
        "10"
    );

    assert.equal(result.discount_amount, "0.01");
    assert.equal(result.total_amount, "0.04");
});

test("7. Zero, full and fractional percentage discounts work", () => {
    assert.equal(
        calculateOrderAmounts(items, reserved, "0").total_amount,
        "200.00"
    );

    assert.equal(
        calculateOrderAmounts(items, reserved, "100").total_amount,
        "0.00"
    );

    assert.equal(
        calculateOrderAmounts(items, reserved, "2.55").total_amount,
        "194.90"
    );
});

test("8. Large monetary values retain precision", () => {
    const result = calculateOrderAmounts(
        [{ pid: 1, qty: 2147483647 }], [{
            pid: 1,
            qty: 2147483647,
            unit_price: "999999999999.99"
        }],
        "0"
    );

    assert.equal(
        result.subtotal,
        "2147483646999978525163.53"
    );
});

test("9. Reject mismatched reservation data and invalid prices", () => {
    for (const value of[
            [],
            null, [null], [...reserved, ...reserved], [{ pid: 2, qty: 2, unit_price: "100" }], [{ pid: 1, qty: 1, unit_price: "100" }],
            ...["0", "-1", "NaN", "1.001", "1000000000000", 100]
            .map(unit_price => [
                { pid: 1, qty: 2, unit_price }
            ])
        ]) {
        assert.throws(
            () => calculateOrderAmounts(items, value, "10"), { code: "INVALID_PRODUCT_RESPONSE" }
        );
    }
});

test("10. Reject invalid discount rates", () => {
    for (const rate of[
            "-1", "100.01", "NaN", "1.234", "1e1", 10, null
        ]) {
        assert.throws(
            () => calculateOrderAmounts(items, reserved, rate), { code: "INVALID_DISCOUNT_RATE" }
        );
    }
});