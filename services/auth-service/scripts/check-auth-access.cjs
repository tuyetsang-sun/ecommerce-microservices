const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const jwt = require("jsonwebtoken");

const { pool } = require("../src/infrastructure/db");

const {
    JWT_ISSUER,
    JWT_AUDIENCE
} = require("../src/infrastructure/security/tokens");

const baseUrl = (
    process.argv[2] || "http://api-gateway:3000"
).replace(/\/$/, "");

const username = "access_" + randomBytes(8).toString("hex");
const password = randomBytes(16).toString("hex");

async function request(path, expectedStatus, options = {}) {
    const response = await fetch(baseUrl + path, {
        ...options,
        signal: AbortSignal.timeout(15000)
    });

    assert.equal(
        response.status,
        expectedStatus,
        path + ": unexpected status"
    );

    assert.equal(
        response.headers.get("cache-control"),
        "no-store"
    );

    if (expectedStatus === 401) {
        assert.match(
            response.headers.get("www-authenticate"),
            /^Bearer/
        );
    }

    return response.json();
}

function post(body) {
    return {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    };
}

function bearer(token) {
    return {
        headers: {
            Authorization: "Bearer " + token
        }
    };
}

async function main() {
    try {
        await request("/api/auth/me", 401);

        await request("/api/auth/me", 401, {
            headers: {
                Authorization: "Basic abc"
            }
        });

        console.log(
            "OK: Missing or malformed Bearer header -> 401"
        );

        const created = await request(
            "/api/auth/register",
            201,
            post({ username, password })
        );

        const login = await request(
            "/api/auth/login",
            200,
            post({ username, password })
        );

        const identity = await request(
            "/api/auth/me",
            200,
            bearer(login.accessToken)
        );

        assert.deepEqual(identity, {
            uid: created.uid,
            username,
            role: "normal"
        });

        console.log(
            "OK: Valid JWT -> current account identity"
        );

        const spoofed = await request(
            "/api/auth/me",
            200, {
                headers: {
                    Authorization: "Bearer " + login.accessToken,
                    "X-User-Id": "999",
                    "X-User-Role": "admin"
                }
            }
        );

        assert.deepEqual(spoofed, identity);

        console.log(
            "OK: Client headers cannot replace identity or role"
        );

        const parts = login.accessToken.split(".");

        const payload = JSON.parse(
            Buffer.from(parts[1], "base64url").toString("utf8")
        );

        payload.role = "admin";

        parts[1] = Buffer.from(
            JSON.stringify(payload)
        ).toString("base64url");

        await request(
            "/api/auth/me",
            401,
            bearer(parts.join("."))
        );

        const expired = jwt.sign({ username, role: "normal" },
            process.env.AUTH_JWT_SECRET, {
                algorithm: "HS256",
                subject: String(created.uid),
                issuer: JWT_ISSUER,
                audience: JWT_AUDIENCE,
                expiresIn: -1
            }
        );

        await request(
            "/api/auth/me",
            401,
            bearer(expired)
        );

        console.log(
            "OK: Tampered or expired JWT -> 401"
        );

        await pool.query(
            "DELETE FROM public.users WHERE uid = $1 AND username = $2", [created.uid, username]
        );

        await request(
            "/api/auth/me",
            401,
            bearer(login.accessToken)
        );

        console.log(
            "OK: Deleted account cannot keep using its JWT"
        );
    } finally {
        try {
            await pool.query(
                "DELETE FROM public.users WHERE username = $1", [username]
            );
        } finally {
            await pool.end();
        }
    }
}

main().then(() => {
    console.log(
        "AUTH ACCESS CHECK PASSED (test account cleaned up)"
    );
}).catch(error => {
    console.error(
        "AUTH ACCESS CHECK FAILED:",
        error.code || error.name,
        error.message
    );

    process.exitCode = 1;
});