const express = require("express");
const { createAuthenticate } = require("../middlewares/auth");
const { HttpError } = require("../middlewares/error-handler");

function createOrderRouter({
    verifyToken,
    callOrder,
    productCache
}) {
    const router = express.Router();

    router.use(createAuthenticate(verifyToken));

    router.post(
        "/",
        (req, res, next) => {
            if (!req.is("application/json")) {
                return next(new HttpError(
                    415,
                    "Content-Type must be application/json"
                ));
            }

            next();
        },
        express.json({ limit: "16kb", strict: true }),
        async(req, res) => {
            const body = req.body;
            const key = req.get("Idempotency-Key");

            if (
                typeof key !== "string" ||
                !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key)
            ) {
                throw new HttpError(
                    400,
                    "Valid Idempotency-Key header is required"
                );
            }

            if (!body ||
                Array.isArray(body) ||
                Object.keys(body).some(k => k !== "items") ||
                !Array.isArray(body.items) ||
                body.items.length < 1 ||
                body.items.length > 100
            ) {
                throw new HttpError(
                    400,
                    "Send items containing 1 to 100 product lines"
                );
            }

            for (const item of body.items) {
                if (!item ||
                    typeof item !== "object" ||
                    Array.isArray(item) ||
                    Object.keys(item).some(
                        k => !["pid", "qty"].includes(k)
                    ) ||
                    !Number.isInteger(item.pid) ||
                    item.pid < 1 ||
                    item.pid > 2147483647 ||
                    !Number.isInteger(item.qty) ||
                    item.qty < 1 ||
                    item.qty > 2147483647
                ) {
                    throw new HttpError(
                        400,
                        "Each item requires positive int32 pid and qty only"
                    );
                }
            }

            const order = await productCache.mutate(() =>
                callOrder(
                    "createOrder", {
                        items: body.items,
                        idempotency_key: key
                    },
                    req.accessToken
                )
            );

            res.location("/api/orders/" + order.oid);
            res.status(201).json(order);
        }
    );

    router.get("/", async(req, res) => {
        const result = await callOrder(
            "listOrders", {},
            req.accessToken
        );

        res.json(result.items || []);
    });

    router.get("/:oid", async(req, res) => {
        const text = req.params.oid;
        const oid = Number(text);

        if (!/^[1-9][0-9]{0,9}$/.test(text) ||
            oid > 2147483647
        ) {
            throw new HttpError(400, "Invalid order ID");
        }

        res.json(await callOrder(
            "getOrder", { oid },
            req.accessToken
        ));
    });

    return router;
}

module.exports = { createOrderRouter };