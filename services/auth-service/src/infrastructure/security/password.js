const bcrypt = require("bcryptjs");

const BCRYPT_ROUNDS = 12;

async function hashPassword(password) {
    if (typeof password !== "string" || password.length === 0) {
        throw new TypeError("Password must be a non-empty string");
    }

    if (Buffer.byteLength(password, "utf8") > 72) {
        throw new RangeError("Password exceeds the 72-byte bcrypt limit");
    }

    return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyPassword(password, hash) {
    if (
        typeof password !== "string" ||
        password.length === 0 ||
        Buffer.byteLength(password, "utf8") > 72 ||
        typeof hash !== "string"
    ) {
        return false;
    }

    return bcrypt.compare(password, hash);
}

module.exports = { hashPassword, verifyPassword };