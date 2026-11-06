const assert = require("node:assert/strict");
const fs = require("node:fs");

async function main() {
    const username = (process.argv[2] || "").trim();
    const password = fs.readFileSync(0, "utf8");

    assert.ok(
        username && password,
        "Username and stdin password are required"
    );

    const baseUrl =
        "http://127.0.0.1:" + (process.env.PORT || "3000");

    const login = await fetch(baseUrl + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        signal: AbortSignal.timeout(10000)
    });

    assert.equal(
        login.status,
        200,
        "Login must return HTTP 200"
    );

    const data = await login.json();

    assert.equal(
        typeof data.accessToken,
        "string",
        "Access token is required"
    );

    assert.ok(
        data.accessToken.length > 0,
        "Access token must not be empty"
    );

    const response = await fetch(baseUrl + "/api/auth/me", {
        headers: {
            Authorization: "Bearer " + data.accessToken
        },
        signal: AbortSignal.timeout(10000)
    });

    assert.equal(
        response.status,
        200,
        "Authenticated /me must return HTTP 200"
    );

    const identity = await response.json();

    assert.equal(
        identity.role,
        "admin",
        "Account must have admin role"
    );

    assert.equal(
        identity.username.toLowerCase(),
        username.toLowerCase()
    );

    assert.ok(
        Number.isInteger(identity.uid) && identity.uid > 0
    );

    const anonymous = await fetch(baseUrl + "/api/auth/me", {
        signal: AbortSignal.timeout(10000)
    });

    assert.equal(
        anonymous.status,
        401,
        "Anonymous /me must return HTTP 401"
    );

    console.log(
        "ADMIN HTTP CHECK PASSED:",
        JSON.stringify(identity)
    );
}

main().catch(error => {
    console.error("ADMIN HTTP CHECK FAILED:", error.message);
    process.exitCode = 1;
});