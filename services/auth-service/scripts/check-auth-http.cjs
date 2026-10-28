const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");

const { pool } = require("../src/infrastructure/db");
const {
    createTokenService
} = require("../src/infrastructure/security/tokens");

const baseUrl = (
    process.argv[2] || "http://api-gateway:3000"
).replace(/\/$/, "");

const base = "http_" + randomBytes(8).toString("hex");
const names = [base, base + "_other"];

const account = {
    username: base,
    password: "P@ss123",
    email: base + "@example.test",
    fullname: "Auth REST test",
    phone: "0900000000"
};

async function post(path, body, expectedStatus, options = {}) {
    const response = await fetch(baseUrl + path, {
        method: "POST",
        headers: {
            "Content-Type": options.contentType || "application/json"
        },
        body: options.raw === undefined ?
            JSON.stringify(body) :
            options.raw,
        signal: AbortSignal.timeout(15000)
    });

    assert.equal(
        response.status,
        expectedStatus,
        `${path}: unexpected HTTP status`
    );

    assert.equal(
        response.headers.get("cache-control"),
        "no-store"
    );

    const requestId = response.headers.get("x-request-id");
    assert.ok(requestId);

    const data = await response.json();

    if (expectedStatus >= 400) {
        assert.equal(typeof data.message, "string");
        assert.equal(data.requestId, requestId);
    }

    return data;
}

async function main() {
    try {
        const created = await post(
            "/api/auth/register",
            account,
            201
        );

        assert.ok(
            Number.isInteger(created.uid) && created.uid > 0
        );

        assert.equal(
            created.message,
            "User registered successfully"
        );

        assert.deepEqual(
            Object.keys(created).sort(), ["message", "uid"]
        );

        console.log("TC-IAM-01 PASS: register -> 201");

        await post("/api/auth/register", {
            ...account,
            username: base.toUpperCase(),
            email: base + "_new@example.test"
        }, 409);

        await post("/api/auth/register", {
            ...account,
            username: names[1],
            email: account.email.toUpperCase()
        }, 409);

        console.log(
            "TC-IAM-02 PASS: duplicate username/email -> 409"
        );

        await post("/api/auth/register", {
            username: names[1]
        }, 400);

        await post("/api/auth/register", {
            username: names[1],
            password: ""
        }, 400);

        console.log(
            "TC-IAM-03 PASS: missing password -> 400"
        );

        const login = await post("/api/auth/login", {
            username: base.toUpperCase(),
            password: account.password
        }, 200);

        assert.deepEqual(
            Object.keys(login).sort(), ["accessToken", "expiresIn", "tokenType"]
        );

        assert.equal(login.tokenType, "Bearer");
        assert.equal(login.expiresIn, 3600);

        const tokens = createTokenService({
            secret: process.env.AUTH_JWT_SECRET
        });

        const identity = tokens.verifyAccessToken(
            login.accessToken
        );

        assert.equal(identity.uid, created.uid);
        assert.equal(identity.role, "normal");

        console.log(
            "TC-IAM-04 PASS: login -> 200 and valid JWT"
        );

        const wrong = await post("/api/auth/login", {
            username: base,
            password: "wrong"
        }, 401);

        const missing = await post("/api/auth/login", {
            username: names[1],
            password: account.password
        }, 401);

        assert.equal(wrong.message, missing.message);

        console.log(
            "TC-IAM-05 PASS: wrong credentials -> 401"
        );

        await post("/api/auth/login", {
            username: base
        }, 400);

        await post("/api/auth/register", {
            username: names[1],
            password: 123456
        }, 400);

        await post("/api/auth/register", {
            username: names[1],
            password: account.password,
            role: "admin"
        }, 400);

        await post("/api/auth/register", {
            username: names[1],
            password: account.password,
            email: "invalid-email"
        }, 400);

        await post("/api/auth/login", [], 400);

        await post("/api/auth/login", null, 400, {
            raw: "{"
        });

        await post("/api/auth/login", null, 400, {
            raw: ""
        });

        await post("/api/auth/login", {
            username: base,
            password: account.password
        }, 415, {
            contentType: "text/plain"
        });

        await post("/api/auth/register", {
            username: "x".repeat(17000),
            password: account.password
        }, 413);

        console.log(
            "EXTRA PASS: validation, JSON errors, content type and body size limit"
        );
    } finally {
        try {
            await pool.query(
                "DELETE FROM public.users WHERE lower(username) = ANY($1::text[])", [names]
            );
        } finally {
            await pool.end();
        }
    }
}

main().then(() => {
    console.log(
        "AUTH HTTP CHECK PASSED (test accounts cleaned up)"
    );
}).catch(error => {
    console.error(
        "AUTH HTTP CHECK FAILED:",
        error.code || error.name,
        error.message
    );

    process.exitCode = 1;
});