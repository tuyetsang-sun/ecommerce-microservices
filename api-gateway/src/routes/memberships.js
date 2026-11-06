const express = require("express");
const { createAuthenticate, requireRoles } = require("../middlewares/auth");
const { HttpError } = require("../middlewares/error-handler");

function validInt(value, min) {
    return Number.isInteger(value) && value >= min && value <= 2147483647;
}

function membershipResponse(value) {
    if (!value || !validInt(value.mid, 1) ||
        typeof value.mname !== "string" || !value.mname.trim() ||
        !validInt(value.score, 0)) {
        throw new HttpError(502, "Invalid membership service response");
    }

    return {
        mid: value.mid,
        mname: value.mname,
        score: value.score
    };
}

function membershipInput(body, creating) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new HttpError(400, "Request body must be a JSON object");
    }

    const keys = Object.keys(body);

    if (keys.length === 0 ||
        keys.some(key => !["mname", "score"].includes(key))) {
        throw new HttpError(400, "Send mname and/or score only");
    }

    const hasName = Object.hasOwn(body, "mname");
    const hasScore = Object.hasOwn(body, "score");

    if (creating && (!hasName || !hasScore)) {
        throw new HttpError(400, "mname and score are required");
    }

    const input = {};

    if (hasName) {
        if (typeof body.mname !== "string" || !body.mname.trim() ||
            body.mname.trim().length > 50 ||
            body.mname.includes("\u0000")) {
            throw new HttpError(
                400,
                "mname must contain 1 to 50 characters"
            );
        }

        input.mname = body.mname.trim();
    }

    if (hasScore) {
        if (!validInt(body.score, 0)) {
            throw new HttpError(
                400,
                "score must be an integer from 0 to 2147483647"
            );
        }

        input.score = body.score;
    }

    return input;
}

function createMembershipRouter({ verifyToken, callCustomer }) {
    const router = express.Router();
    const parseJson = express.json({ limit: "16kb", strict: true });

    router.use(createAuthenticate(verifyToken));

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

    router.get("/", async(req, res) => {
        const result = await callCustomer(
            "listMemberships", {},
            req.accessToken
        );

        if (!result ||
            (result.items !== undefined && !Array.isArray(result.items))) {
            throw new HttpError(502, "Invalid membership list response");
        }

        res.json({
            items: (result.items || []).map(membershipResponse)
        });
    });

    router.post(
        "/",
        requireRoles("admin"),
        requireJson,
        parseJson,
        async(req, res) => {
            const result = await callCustomer(
                "createMembership",
                membershipInput(req.body, true),
                req.accessToken
            );

            const item = membershipResponse(result);
            res.status(201).json(item);
        }
    );

    router.put(
        "/:mid",
        requireRoles("admin"),
        requireJson,
        parseJson,
        async(req, res) => {
            const rawMid = req.params.mid;
            const mid = Number(rawMid);

            if (!/^[1-9][0-9]{0,9}$/.test(rawMid) || !validInt(mid, 1)) {
                throw new HttpError(400, "mid must be a positive int32");
            }

            const input = {
                mid,
                ...membershipInput(req.body, false)
            };

            const result = await callCustomer(
                "updateMembership",
                input,
                req.accessToken
            );

            const item = membershipResponse(result);

            if (item.mid !== mid) {
                throw new HttpError(502, "Membership response ID mismatch");
            }

            res.json(item);
        }
    );

    return router;
}

module.exports = { createMembershipRouter };