class ProductError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "ProductError";
        this.code = code;
    }
}

module.exports = { ProductError };