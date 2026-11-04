class CustomerError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "CustomerError";
        this.code = code;
    }
}

module.exports = { CustomerError };