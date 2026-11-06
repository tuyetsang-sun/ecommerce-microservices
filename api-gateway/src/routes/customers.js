const express = require("express");

const {
    createAuthenticate
} = require("../middlewares/auth");

const {
    HttpError
} = require("../middlewares/error-handler");

function positiveId(value) {
    return (
        Number.isInteger(value) &&
        value > 0 &&
        value <= 2147483647
    );
}

function profileResponse(result, uid) {
    if (!result ||
        result.uid !== uid ||
        typeof result.fullname !== "string" ||
        !positiveId(result.mid)
    ) {
        throw new HttpError(
            502,
            "Invalid response from customer service"
        );
    }

    return {
        uid: result.uid,
        fullname: result.fullname,
        mid: result.mid
    };
}

function createCustomerRouter({ verifyToken, callCustomer }) {
    const router = express.Router();

    const parseJson = express.json({
        limit: "16kb",
        strict: true
    });

    router.use(createAuthenticate(verifyToken));

    router.param("uid", (req, res, next, value) => {
        if (!/^[1-9][0-9]{0,9}$/.test(value) ||
            !positiveId(Number(value))
        ) {
            return next(
                new HttpError(400, "uid must be a positive int32")
            );
        }

        req.customerUid = Number(value);

        if (
            req.auth.role !== "admin" &&
            req.auth.uid !== req.customerUid
        ) {
            return next(
                new HttpError(
                    403,
                    "You cannot access another customer's profile"
                )
            );
        }

        next();
    });

    function requireJson(req, res, next) {
        const type = (req.get("Content-Type") || "")
            .split(";")[0]
            .trim()
            .toLowerCase();

        if (type !== "application/json") {
            return next(
                new HttpError(
                    415,
                    "Content-Type must be application/json"
                )
            );
        }

        next();
    }

    function updateInput(req) {
        const body = req.body;

        if (!body ||
            typeof body !== "object" ||
            Array.isArray(body)
        ) {
            throw new HttpError(
                400,
                "Request body must be a JSON object"
            );
        }

        const fields = Object.keys(body);

        if (
            fields.length === 0 ||
            fields.some(field => !["fullname", "mid"].includes(field))
        ) {
            throw new HttpError(
                400,
                "Send fullname and/or mid only"
            );
        }

        const input = {
            uid: req.customerUid
        };

        if (Object.prototype.hasOwnProperty.call(body, "mid")) {
            if (req.auth.role !== "admin") {
                throw new HttpError(
                    403,
                    "Only admin can change membership"
                );
            }

            if (!positiveId(body.mid)) {
                throw new HttpError(
                    400,
                    "mid must be a positive int32"
                );
            }

            input.mid = body.mid;
        }

        if (Object.prototype.hasOwnProperty.call(body, "fullname")) {
            if (
                typeof body.fullname !== "string" ||
                !body.fullname.trim() ||
                body.fullname.trim().length > 100 ||
                body.fullname.includes("\0")
            ) {
                throw new HttpError(
                    400,
                    "fullname must contain 1 to 100 characters"
                );
            }

            input.fullname = body.fullname.trim();
        }

        return input;
    }

    router.get("/:uid", async(req, res) => {
        const result = await callCustomer(
            "getCustomer", { uid: req.customerUid },
            req.accessToken
        );

        res.json(profileResponse(result, req.customerUid));
    });

    router.put(
        "/:uid",
        requireJson,
        parseJson,
        async(req, res) => {
            const result = await callCustomer(
                "updateCustomer",
                updateInput(req),
                req.accessToken
            );

            profileResponse(result, req.customerUid);

            res.json({
                message: "Customer updated successfully",
                uid: req.customerUid
            });
        }
    );

    router.get("/:uid/membership", async(req, res) => {
        const result = await callCustomer(
            "getMembership", { uid: req.customerUid },
            req.accessToken
        );

        if (!result ||
            !positiveId(result.mid) ||
            typeof result.mname !== "string" ||
            !Number.isInteger(result.score) ||
            result.score < 0
        ) {
            throw new HttpError(
                502,
                "Invalid response from customer service"
            );
        }

        res.json({
            mid: result.mid,
            mname: result.mname,
            score: result.score
        });
    });

    return router;
}

module.exports = { createCustomerRouter };