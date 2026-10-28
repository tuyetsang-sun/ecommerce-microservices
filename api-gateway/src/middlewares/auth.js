const grpc = require("@grpc/grpc-js");
const { HttpError } = require("./error-handler");

const knownRoles = new Set(["normal", "admin"]);

function unauthorized(res, message, invalidToken = false) {
    res.set("Cache-Control", "no-store");

    res.set(
        "WWW-Authenticate",
        invalidToken ?
        'Bearer realm="ecommerce", error="invalid_token"' :
        'Bearer realm="ecommerce"'
    );

    return new HttpError(401, message);
}

function createAuthenticate(verifyToken) {
    if (typeof verifyToken !== "function") {
        throw new TypeError("verifyToken must be a function");
    }

    return async function authenticate(req, res, next) {
        res.set("Cache-Control", "no-store");

        const header = req.get("Authorization");

        if (!header) {
            throw unauthorized(res, "Bearer token is required");
        }

        let headerCount = 0;

        for (let i = 0; i < req.rawHeaders.length; i += 2) {
            if (req.rawHeaders[i].toLowerCase() === "authorization") {
                headerCount++;
            }
        }

        const match =
            /^Bearer[ \t]+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(header);

        if (headerCount !== 1 || header.length > 8192 || !match) {
            throw unauthorized(res, "Invalid Authorization header");
        }

        const accessToken = match[1];
        let identity;

        try {
            identity = await verifyToken(accessToken);
        } catch (error) {
            if (error.code === grpc.status.UNAUTHENTICATED) {
                throw unauthorized(
                    res,
                    "Invalid or expired access token",
                    true
                );
            }

            throw error;
        }

        const expiresAt = Number(identity && identity.expires_at);

        if (!identity ||
            !Number.isInteger(identity.uid) ||
            identity.uid < 1 ||
            identity.uid > 2147483647 ||
            typeof identity.username !== "string" ||
            !identity.username ||
            !knownRoles.has(identity.role) ||
            !Number.isSafeInteger(expiresAt)
        ) {
            throw new HttpError(
                502,
                "Invalid response from authentication service"
            );
        }

        if (expiresAt <= Math.floor(Date.now() / 1000)) {
            throw unauthorized(
                res,
                "Invalid or expired access token",
                true
            );
        }

        req.auth = Object.freeze({
            uid: identity.uid,
            username: identity.username,
            role: identity.role,
            expiresAt
        });

        req.accessToken = accessToken;

        next();
    };
}

function requireRoles(...roles) {
    if (
        roles.length === 0 ||
        roles.some(role => !knownRoles.has(role))
    ) {
        throw new TypeError(
            "requireRoles needs valid roles: normal or admin"
        );
    }

    const allowed = new Set(roles);

    return (req, res, next) => {
        if (!req.auth) {
            return next(
                unauthorized(res, "Authentication is required")
            );
        }

        if (!allowed.has(req.auth.role)) {
            return next(
                new HttpError(403, "Insufficient permissions")
            );
        }

        next();
    };
}

module.exports = { createAuthenticate, requireRoles };