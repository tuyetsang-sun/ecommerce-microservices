const express = require("express");
const {
    createAuthenticate,
    requireRoles
} = require("../middlewares/auth");
const { HttpError } = require("../middlewares/error-handler");

function isInt32(value, minimum) {
    return Number.isInteger(value) &&
        value >= minimum &&
        value <= 2147483647;
}

function productResponse(row) {
    if (!row ||
        !isInt32(row.pid, 1) ||
        typeof row.pname !== "string" ||
        !row.pname.trim() ||
        row.pname.length > 120 ||
        row.pname.includes("\0") ||
        typeof row.price !== "string" ||
        !/^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/.test(row.price) ||
        Number(row.price) <= 0 ||
        !isInt32(row.quantity, 0)
    ) {
        throw new HttpError(
            502,
            "Invalid response from product service"
        );
    }

    return {
        pid: row.pid,
        pname: row.pname,
        price: Number(row.price),
        quantity: row.quantity
    };
}

function readPid(value) {
    if (!/^[1-9][0-9]{0,9}$/.test(value) ||
        !isInt32(Number(value), 1)
    ) {
        throw new HttpError(400, "pid must be a positive int32");
    }

    return Number(value);
}

function requireJson(req, res, next) {
    const type = (req.get("Content-Type") || "")
        .split(";")[0]
        .trim()
        .toLowerCase();

    if (type !== "application/json") {
        return next(
            new HttpError(415, "Content-Type must be application/json")
        );
    }

    next();
}

function productInput(body, creating) {
    if (!body ||
        typeof body !== "object" ||
        Array.isArray(body)
    ) {
        throw new HttpError(400, "Request body must be a JSON object");
    }

    const allowed = ["pname", "price", "quantity"];
    const fields = Object.keys(body);

    if (
        fields.length === 0 ||
        fields.some(key => !allowed.includes(key))
    ) {
        throw new HttpError(
            400,
            "Send pname, price and/or quantity only"
        );
    }

    if (
        creating &&
        allowed.some(key => !Object.hasOwn(body, key))
    ) {
        throw new HttpError(
            400,
            "pname, price and quantity are required"
        );
    }

    const input = {};

    if (Object.hasOwn(body, "pname")) {
        if (
            typeof body.pname !== "string" ||
            !body.pname.trim() ||
            body.pname.trim().length > 120 ||
            body.pname.includes("\0")
        ) {
            throw new HttpError(
                400,
                "pname must contain 1 to 120 characters"
            );
        }

        input.pname = body.pname.trim();
    }

    if (Object.hasOwn(body, "price")) {
        if (!["number", "string"].includes(typeof body.price)) {
            throw new HttpError(
                400,
                "price must be a positive decimal"
            );
        }

        const price = String(body.price).trim();

        if (!/^(0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/.test(price) ||
            Number(price) <= 0
        ) {
            throw new HttpError(
                400,
                "price must be positive with at most 2 decimal places"
            );
        }

        input.price = price;
    }

    if (Object.hasOwn(body, "quantity")) {
        if (!isInt32(body.quantity, 0)) {
            throw new HttpError(
                400,
                "quantity must be a nonnegative int32"
            );
        }

        input.quantity = body.quantity;
    }

    return input;
}

function createProductRouter({ verifyToken, callProduct }) {
    const router = express.Router();

    router.use(createAuthenticate(verifyToken));

    router.get("/", async(req, res) => {
        const result = await callProduct(
            "listProducts", {},
            req.accessToken
        );

        if (!result ||
            typeof result !== "object" ||
            Array.isArray(result)
        ) {
            throw new HttpError(
                502,
                "Invalid response from product service"
            );
        }

        // Protobuf có thể bỏ trường items khi danh sách rỗng.
        const items = result.items === undefined ? [] : result.items;

        if (!Array.isArray(items)) {
            throw new HttpError(
                502,
                "Invalid response from product service"
            );
        }

        res.json(items.map(productResponse));
    });

    router.get("/:pid", async(req, res) => {
        const value = req.params.pid;

        if (!/^[1-9][0-9]{0,9}$/.test(value) ||
            !isInt32(Number(value), 1)
        ) {
            throw new HttpError(
                400,
                "pid must be a positive int32"
            );
        }

        const pid = Number(value);

        const result = await callProduct(
            "getProduct", { pid },
            req.accessToken
        );

        const product = productResponse(result);

        if (product.pid !== pid) {
            throw new HttpError(
                502,
                "Invalid response from product service"
            );
        }

        res.json(product);
    });
    const adminOnly = requireRoles("admin");

    const parseJson = express.json({
        limit: "16kb",
        strict: true
    });

    router.post(
        "/",
        adminOnly,
        requireJson,
        parseJson,
        async(req, res) => {
            const input = productInput(req.body, true);

            const result = await callProduct(
                "createProduct",
                input,
                req.accessToken
            );

            const product = productResponse(result);

            res.location("/api/products/" + product.pid);
            res.status(201).json(product);
        }
    );

    router.put(
        "/:pid",
        adminOnly,
        requireJson,
        parseJson,
        async(req, res) => {
            const pid = readPid(req.params.pid);

            const input = {
                pid,
                ...productInput(req.body, false)
            };

            const result = await callProduct(
                "updateProduct",
                input,
                req.accessToken
            );

            const product = productResponse(result);

            if (product.pid !== pid) {
                throw new HttpError(
                    502,
                    "Invalid response from product service"
                );
            }

            res.json(product);
        }
    );

    router.delete(
        "/:pid",
        adminOnly,
        async(req, res) => {
            const pid = readPid(req.params.pid);

            const result = await callProduct(
                "deleteProduct", { pid },
                req.accessToken
            );

            if (!result ||
                result.message !== "Product deleted successfully"
            ) {
                throw new HttpError(
                    502,
                    "Invalid response from product service"
                );
            }

            res.json({
                message: result.message,
                pid
            });
        }
    );
    return router;
}

module.exports = { createProductRouter };