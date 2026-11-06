const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
    getDiscountRate
} = require("../src/domain/discount-policy");

const {
    priceOrder
} = require("../src/application/price-order");

const items = [{ pid: 1, qty: 2 }];

const reservedItems = [
    { pid: 1, qty: 2, unit_price: "100.00" }
];

const membership = {
    mid: 2,
    mname: "gold_demo",
    score: 500
};

test("1. Discount boundaries match the agreed policy", () => {
    for (const [score, rate] of[
            [0, "0.00"], [10, "0.00"], [99, "0.00"], [100, "5.00"], [499, "5.00"], [500, "10.00"], [999, "10.00"], [1000, "15.00"], [2147483647, "15.00"]
        ]) {
        assert.equal(getDiscountRate(score), rate);
    }
});

test("2. Invalid membership scores are rejected", () => {
    for (const score of[-1, 1.5, "500", null, NaN, Infinity, 2147483648]) {
        assert.throws(
            () => getDiscountRate(score), { code: "INVALID_MEMBERSHIP_RESPONSE" }
        );
    }
});

test("3. Score 500 produces subtotal 200, discount 20 and total 180", () => {
    assert.deepEqual(
        priceOrder({ items, reservedItems, membership }), {
            items: reservedItems,
            score: 500,
            subtotal: "200.00",
            discount_rate: "10.00",
            discount_amount: "20.00",
            total_amount: "180.00"
        }
    );
});

test("4. Membership name does not determine the discount", () => {
    const result = priceOrder({
        items,
        reservedItems,
        membership: {
            ...membership,
            mname: "Gold",
            score: 10
        }
    });

    assert.equal(result.discount_rate, "0.00");
    assert.equal(result.total_amount, "200.00");
});

test("5. All score tiers produce the expected totals", () => {
    for (const [score, total] of[
            [10, "200.00"], [100, "190.00"], [500, "180.00"], [1000, "170.00"]
        ]) {
        const result = priceOrder({
            items,
            reservedItems,
            membership: {...membership, score }
        });

        assert.equal(result.total_amount, total);
    }
});

test("6. Missing or invalid membership is rejected", () => {
    for (const value of[
            null, {}, [], {...membership, mid: 0 }, {...membership, mid: "2" }, {...membership, mname: " " }
        ]) {
        assert.throws(
            () => priceOrder({
                items,
                reservedItems,
                membership: value
            }), { code: "INVALID_MEMBERSHIP_RESPONSE" }
        );
    }
});

test("7. Later membership changes do not change an existing quote", () => {
    const current = {...membership };

    const oldQuote = priceOrder({
        items,
        reservedItems,
        membership: current
    });

    current.score = 1000;

    const newQuote = priceOrder({
        items,
        reservedItems,
        membership: current
    });

    assert.equal(oldQuote.score, 500);
    assert.equal(oldQuote.discount_rate, "10.00");
    assert.equal(oldQuote.total_amount, "180.00");
    assert.equal(newQuote.total_amount, "170.00");
});