const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const grpc = require("@grpc/grpc-js");

const {
    createAuthenticate,
    requireRoles
} = require("../src/middlewares/auth");

const {
    errorHandler
} = require("../src/middlewares/error-handler");

let server;
let baseUrl;
let verificationCalls = 0;

// Chỉ giả lập kết quả xác minh trong unit test.
async function verifyToken(token) {
    verificationCalls++;

    if (token === "down.payload.signature") {
        throw { code: grpc.status.UNAVAILABLE };
    }

    if (token === "slow.payload.signature") {
        throw { code: grpc.status.DEADLINE_EXCEEDED };
    }

    if (token === "bad.payload.signature") {
        return { uid: 0 };
    }

    if (token === "old.payload.signature") {
        return {
            uid: 1,
            username: "normal_user",
            role: "normal",
            expires_at: "1"
        };
    }

    if (![
            "normal.payload.signature",
            "admin.payload.signature"
        ].includes(token)) {
        throw { code: grpc.status.UNAUTHENTICATED };
    }

    const admin = token.startsWith("admin.");

    return {
        uid: admin ? 2 : 1,
        username: admin ? "admin_user" : "normal_user",
        role: admin ? "admin" : "normal",
        expires_at: String(
            Math.floor(Date.now() / 1000) + 3600
        )
    };
}

before(async() => {
    const app = express();
    const authenticate = createAuthenticate(verifyToken);

    app.get("/me", authenticate, (req, res) => {
        res.json({
            uid: req.auth.uid,
            role: req.auth.role
        });
    });

    app.get(
        "/admin",
        authenticate,
        requireRoles("admin"),
        (req, res) => res.json({ ok: true })
    );

    app.get(
        "/roles-only",
        requireRoles("admin"),
        (req, res) => res.json({ ok: true })
    );

    app.use(errorHandler);

    await new Promise((resolve, reject) => {
        server = app.listen(0, "127.0.0.1", resolve);
        server.once("error", reject);
    });

    baseUrl = "http://127.0.0.1:" + server.address().port;
});

after(async() => {
    if (!server) return;

    await new Promise(resolve => {
        server.close(resolve);
        server.closeAllConnections();
    });
});

function get(path, headers = {}) {
    return fetch(baseUrl + path, {
        headers,
        signal: AbortSignal.timeout(5000)
    });
}

test("Missing or malformed Authorization is rejected before verification", async() => {
    const previous = verificationCalls;

    for (const headers of[{}, { "X-User-Role": "admin" }, { Authorization: "Basic abc" }, { Authorization: "Bearer invalid" }, {
            Authorization: "Bearer normal.payload.signature, Bearer admin.payload.signature"
        }]) {
        const response = await get("/me", headers);

        assert.equal(response.status, 401);
        assert.match(
            response.headers.get("www-authenticate"),
            /^Bearer/
        );

        await response.json();
    }

    assert.equal(verificationCalls, previous);
});

test("Identity comes from verification, not user-supplied headers", async() => {
    const response = await get("/me", {
        Authorization: "bearer normal.payload.signature",
        "X-User-Role": "admin",
        "X-User-Id": "999"
    });

    assert.equal(response.status, 200);
    assert.equal(
        response.headers.get("cache-control"),
        "no-store"
    );

    assert.deepEqual(await response.json(), {
        uid: 1,
        role: "normal"
    });
});

test("Admin route returns 403 for normal and 200 for admin", async() => {
    for (const [role, status] of[
            ["normal", 403], ["admin", 200]
        ]) {
        const response = await get("/admin", {
            Authorization: "Bearer " + role + ".payload.signature"
        });

        assert.equal(response.status, status);
        await response.json();
    }
});

test("Role middleware requires authentication and valid configuration", async() => {
    const response = await get("/roles-only");

    assert.equal(response.status, 401);
    await response.json();

    assert.throws(() => requireRoles(), TypeError);
    assert.throws(
        () => requireRoles("superadmin"),
        TypeError
    );
});

test("Rejected token returns 401 with invalid_token challenge", async() => {
    const response = await get("/me", {
        Authorization: "Bearer rejected.payload.signature"
    });

    assert.equal(response.status, 401);
    assert.match(
        response.headers.get("www-authenticate"),
        /invalid_token/
    );

    await response.json();
});

test("Verification service errors remain 503 or 504", async() => {
    for (const [token, status] of[
            ["down.payload.signature", 503], ["slow.payload.signature", 504]
        ]) {
        const response = await get("/me", {
            Authorization: "Bearer " + token
        });

        assert.equal(response.status, status);
        await response.json();
    }
});

test("Invalid identity response and expired identity cannot pass", async() => {
    for (const [token, status] of[
            ["bad.payload.signature", 502], ["old.payload.signature", 401]
        ]) {
        const response = await get("/me", {
            Authorization: "Bearer " + token
        });

        assert.equal(response.status, status);
        await response.json();
    }
});