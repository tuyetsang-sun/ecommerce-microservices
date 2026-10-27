const { AuthError } = require("./auth-error");

function invalid(message) {
    throw new AuthError("VALIDATION_ERROR", message);
}

function requireObject(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        invalid("Request must be an object");
    }
}

function text(value, field, maxLength, optional = false) {
    if (optional && (value === undefined || value === null)) return null;
    if (typeof value !== "string") invalid(`${field} must be a string`);

    const result = value.trim();

    if (optional && result === "") return null;

    if (!result || result.length > maxLength || result.includes("\u0000")) {
        invalid(`${field} must contain 1 to ${maxLength} characters`);
    }

    return result;
}

function password(value) {
    if (typeof value !== "string" || value.length === 0) {
        invalid("password is required");
    }

    if (Buffer.byteLength(value, "utf8") > 72) {
        invalid("password must not exceed 72 UTF-8 bytes");
    }

    return value;
}

function registrationInput(input) {
    requireObject(input);

    const email = text(input.email, "email", 254, true);

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        invalid("email is invalid");
    }

    return {
        username: text(input.username, "username", 50),
        password: password(input.password),
        email: email ? email.toLowerCase() : null,
        phone: text(input.phone, "phone", 20, true),
        fullname: text(input.fullname, "fullname", 100, true)
    };
}

function loginInput(input) {
    requireObject(input);

    return {
        username: text(input.username, "username", 50),
        password: password(input.password)
    };
}

module.exports = { registrationInput, loginInput };