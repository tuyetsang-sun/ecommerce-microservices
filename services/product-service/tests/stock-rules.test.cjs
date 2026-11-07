const test = require("node:test");
const assert = require("node:assert/strict");

const {
    normalizeReserveStock: reserve,
    normalizeReleaseStock: release
} = require("../src/domain/stock-rules");

const id = "aabbccdd-1111-4222-8333-123456789abc";

const request = items => ({
    reservation_id: id,
    items
});

const invalid = fn => {
    assert.throws(fn, { code: "VALIDATION_ERROR" });
};

test("normalizes ID and sorts items without changing input", () => {
    const input = {
        reservation_id: id.toUpperCase(),
        items: [
            { pid: 2, qty: 1 },
            { pid: 1, qty: 2 }
        ]
    };

    const before = structuredClone(input);
    const result = reserve(input);

    assert.equal(result.reservation_id, id);

    assert.deepEqual(result.items, [
        { pid: 1, qty: 2 },
        { pid: 2, qty: 1 }
    ]);

    assert.deepEqual(input, before);
    assert.notEqual(result.items[0], input.items[1]);
});

test("hash ignores item order but detects quantity changes", () => {
    const a = reserve(request([
        { pid: 1, qty: 2 },
        { pid: 2, qty: 1 }
    ]));

    const b = reserve(request([
        { pid: 2, qty: 1 },
        { pid: 1, qty: 2 }
    ]));

    const c = reserve(request([
        { pid: 1, qty: 3 },
        { pid: 2, qty: 1 }
    ]));

    assert.match(a.request_hash, /^[0-9a-f]{64}$/);
    assert.equal(a.request_hash, b.request_hash);
    assert.notEqual(a.request_hash, c.request_hash);
});

test("rejects invalid reservation IDs", () => {
    for (const value of[
            undefined, null, 1, "abc", " " + id, id + "\n"
        ]) {
        invalid(() => reserve({
            reservation_id: value,
            items: [{ pid: 1, qty: 1 }]
        }));
    }
});

test("requires positive int32 pid and qty", () => {
    for (const value of[
            0, -1, 1.5, "1", null, NaN, Infinity, 2147483648
        ]) {
        invalid(() => reserve(request([
            { pid: value, qty: 1 }
        ])));

        invalid(() => reserve(request([
            { pid: 1, qty: value }
        ])));
    }

    reserve(request([
        { pid: 2147483647, qty: 2147483647 }
    ]));
});

test("rejects empty, oversized and duplicate item lists", () => {
    invalid(() => reserve(request([])));
    invalid(() => reserve(request(null)));

    invalid(() => reserve(request([
        { pid: 1, qty: 1 },
        { pid: 1, qty: 2 }
    ])));

    const items = Array.from({ length: 100 },
        (_, i) => ({ pid: i + 1, qty: 1 })
    );

    assert.equal(reserve(request(items)).items.length, 100);

    invalid(() => reserve(request([
        ...items,
        { pid: 101, qty: 1 }
    ])));
});

test("rejects injected price, role and malformed items", () => {
    invalid(() => reserve({
        ...request([{ pid: 1, qty: 1 }]),
        role: "admin"
    }));

    invalid(() => reserve(request([
        { pid: 1, qty: 1, unit_price: "0.01" }
    ])));

    for (const item of[null, [], "abc", {}]) {
        invalid(() => reserve(request([item])));
    }
});

test("release accepts only a valid reservation ID", () => {
    assert.deepEqual(
        release({ reservation_id: id.toUpperCase() }), { reservation_id: id }
    );

    invalid(() => release({ reservation_id: "abc" }));

    invalid(() => release({
        reservation_id: id,
        items: []
    }));

    invalid(() => release(null));
});