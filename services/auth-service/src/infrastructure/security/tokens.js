const jwt = require("jsonwebtoken");

const JWT_ISSUER = "prompt3-auth-service";
const JWT_AUDIENCE = "prompt3-ecommerce";
const ACCESS_TOKEN_TTL_SECONDS = 3600;

function validIdentity(uid, username, role) {
    return (
        Number.isInteger(uid) &&
        uid > 0 &&
        uid <= 2147483647 &&
        typeof username === "string" &&
        username.length > 0 &&
        username.length <= 50 &&
        username === username.trim() && ["normal", "admin"].includes(role)
    );
}

function createTokenService({ secret } = {}) {
    if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
        throw new Error("JWT secret must contain at least 32 bytes");
    }

    function signAccessToken({ uid, username, role }) {
        if (!validIdentity(uid, username, role)) {
            throw new TypeError("Invalid user identity");
        }

        return jwt.sign({ username, role },
            secret, {
                algorithm: "HS256",
                subject: String(uid),
                issuer: JWT_ISSUER,
                audience: JWT_AUDIENCE,
                expiresIn: ACCESS_TOKEN_TTL_SECONDS
            }
        );
    }

    function verifyAccessToken(token) {
        const payload = jwt.verify(token, secret, {
            algorithms: ["HS256"],
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
            maxAge: ACCESS_TOKEN_TTL_SECONDS
        });

        if (!payload || typeof payload !== "object") {
            throw new jwt.JsonWebTokenError("Invalid token claims");
        }

        const uid = Number(payload.sub);
        const now = Math.floor(Date.now() / 1000);

        if (
            String(uid) !== payload.sub ||
            !validIdentity(uid, payload.username, payload.role) ||
            !Number.isInteger(payload.iat) ||
            !Number.isInteger(payload.exp) ||
            payload.iat > now ||
            payload.exp <= payload.iat ||
            payload.exp - payload.iat > ACCESS_TOKEN_TTL_SECONDS
        ) {
            throw new jwt.JsonWebTokenError("Invalid token claims");
        }

        return {
            uid,
            username: payload.username,
            role: payload.role,
            expires_at: payload.exp
        };
    }

    return { signAccessToken, verifyAccessToken };
}

module.exports = {
    createTokenService,
    JWT_ISSUER,
    JWT_AUDIENCE,
    ACCESS_TOKEN_TTL_SECONDS
};