const { OrderError } = require("../domain/order-error");

const {
    getDiscountRate
} = require("../domain/discount-policy");

const {
    calculateOrderAmounts
} = require("../domain/order-pricing");

function priceOrder({ items, reservedItems, membership }) {
    // membership lấy từ Customer Service.
    // reservedItems lấy từ Product Service.

    if (!membership ||
        Array.isArray(membership) ||
        !Number.isInteger(membership.mid) ||
        membership.mid < 1 ||
        membership.mid > 2147483647 ||
        typeof membership.mname !== "string" ||
        !membership.mname.trim() ||
        membership.mname.length > 50 ||
        membership.mname.includes("\0")
    ) {
        throw new OrderError(
            "INVALID_MEMBERSHIP_RESPONSE",
            "Invalid customer membership"
        );
    }

    const discountRate = getDiscountRate(membership.score);

    const amounts = calculateOrderAmounts(
        items,
        reservedItems,
        discountRate
    );

    return {
        ...amounts,
        score: membership.score
    };
}

module.exports = { priceOrder };