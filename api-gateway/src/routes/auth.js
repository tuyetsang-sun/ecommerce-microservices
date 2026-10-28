const express = require("express");
const { callAuth } = require("../clients/auth");
const { HttpError } = require("../middlewares/error-handler");

const authRouter = express.Router();

const parseJson = express.json({
    limit: "16kb",
    strict: true
});
const {
    createAuthenticate
} = require("../middlewares/auth");

function requireJson(req, res, next) {
    res.set("Cache-Control", "no-store");

    const contentType = req.get("Content-Type") || "";
    const mediaType = contentType.split(";")[0].trim().toLowerCase();

    if (mediaType !== "application/json") {
        return next(
            new HttpError(415, "Content-Type must be application/json")
        );
    }

    next();
}

function input(body, optionalFields = []) {
    if (!body ||
        typeof body !== "object" ||
        Array.isArray(body)
    ) {
        throw new HttpError(
            400,
            "Request body must be a JSON object"
        );
    }

    const requiredFields = ["username", "password"];
    const allowed = new Set([
        ...requiredFields,
        ...optionalFields
    ]);

    if (Object.keys(body).some(field => !allowed.has(field))) {
        throw new HttpError(
            400,
            "Request contains unsupported fields"
        );
    }

    const result = {};

    for (const field of requiredFields) {
        if (typeof body[field] !== "string") {
            throw new HttpError(
                400,
                `${field} must be a string`
            );
        }

        result[field] = body[field];
    }

    for (const field of optionalFields) {
        if (body[field] === undefined || body[field] === null) {
            continue;
        }

        if (typeof body[field] !== "string") {
            throw new HttpError(
                400,
                `${field} must be a string`
            );
        }

        result[field] = body[field];
    }

    return result;
}

authRouter.post(
    "/register",
    requireJson,
    parseJson,
    async(req, res) => {
        const request = input(
            req.body, ["fullname", "email", "phone"]
        );

        const result = await callAuth("register", request);

        res.status(201).json({
            message: result.message,
            uid: result.uid
        });
    }
);

authRouter.post(
    "/login",
    requireJson,
    parseJson,
    async(req, res) => {
        const result = await callAuth(
            "login",
            input(req.body)
        );

        res.status(200).json({
            accessToken: result.access_token,
            tokenType: result.token_type,
            expiresIn: result.expires_in
        });
    }
);
const authenticate = createAuthenticate(accessToken =>
    callAuth("verifyToken", {
        access_token: accessToken
    })
);
authRouter.get("/me", authenticate, (req, res) => {
    res.json({
        uid: req.auth.uid,
        username: req.auth.username,
        role: req.auth.role
    });
});

module.exports = { authRouter };