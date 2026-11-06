class OrderError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "OrderError";
        this.code = code;
    }
}

module.exports = { OrderError };