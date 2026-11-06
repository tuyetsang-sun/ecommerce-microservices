const { OrderError } = require("./order-error");

function getDiscountRate(score) {
    if (!Number.isInteger(score) ||
        score < 0 ||
        score > 2147483647
    ) {
        throw new OrderError(
            "INVALID_MEMBERSHIP_RESPONSE",
            "Membership score must be a nonnegative int32"
        );
    }

    if (score >= 1000) return "15.00";
    if (score >= 500) return "10.00";
    if (score >= 100) return "5.00";

    return "0.00";
}

module.exports = { getDiscountRate };