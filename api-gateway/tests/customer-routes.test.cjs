const {
    test,
    before,
    beforeEach,
    after
} = require("node:test");

const assert = require("node:assert/strict");
const express = require("express");

const {
    createCustomerRouter
} = require("../src/routes/customers");

const {
    errorHandler
} = require("../src/middlewares/error-handler");

let server;
let baseUrl;
let rows;
let calls;

beforeEach(() => {
    rows = new Map([
        [1, { uid: 1, fullname: "Original", mid: 1 }],
        [2, { uid: 2, fullname: "Second", mid: 1 }]
    ]);

    calls = [];
});

before(async() => {
    const app = express();

    app.use((req, res, next) => {
        req.requestId = "customer-test";
        next();
    });

    app.use("/api/customers", createCustomerRouter({
        async verifyToken(token) {
            if (![
                    "owner.test.token",
                    "admin.test.token"
                ].includes(token)) {
                throw { code: 16 };
            }

            return {
                uid: token.startsWith("admin") ? 99 : 1,
                username: "fixture",
                role: token.startsWith("admin") ? "admin" : "normal",
                expires_at: String(
                    Math.floor(Date.now() / 1000) + 3600
                )
            };
        },

        async callCustomer(method, input, token) {
            calls.push({ method, input, token });

            const codes = {
                401: 16,
                404: 5,
                500: 13,
                503: 14,
                504: 4
            };

            if (codes[input.uid]) {
                throw {
                    code: codes[input.uid],
                    details: "sensitive backend information"
                };
            }

            if (input.uid === 502) {
                return {
                    uid: 123,
                    fullname: "Wrong user",
                    mid: 1
                };
            }

            const row = rows.get(input.uid);

            if (!row) throw { code: 5 };

            if (method === "updateCustomer") {
                Object.assign(row, input);
            }

            if (method === "getMembership") {
                return {
                    mid: row.mid,
                    mname: "normal",
                    score: 0
                };
            }

            return {
                ...row,
                password_hash: "must-not-leak"
            };
        }
    }));

    app.use((req, res) => {
        res.status(404).json({ message: "Route not found" });
    });

    app.use(errorHandler);

    await new Promise(resolve => {
        server = app.listen(0, "127.0.0.1", resolve);
    });

    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async() => {
    if (server) {
        await new Promise(resolve => {
            server.close(resolve);
            server.closeAllConnections();
        });
    }
});

async function request(path, {
    method = "GET",
    token = "owner.test.token",
    body,
    raw,
    headers = {}
} = {}) {
    const allHeaders = {...headers };

    if (token) {
        allHeaders.Authorization = `Bearer ${token}`;
    }

    if (body !== undefined || raw !== undefined) {
        allHeaders["Content-Type"] =
            allHeaders["Content-Type"] || "application/json";
    }

    const response = await fetch(baseUrl + path, {
        method,
        headers: allHeaders,
        body: raw !== undefined ?
            raw :
            body === undefined ?
            undefined :
            JSON.stringify(body),
        signal: AbortSignal.timeout(5000)
    });

    return {
        status: response.status,
        headers: response.headers,
        body: await response.json()
    };
}

test("missing JWT is rejected before Customer RPC", async() => {
    for (const [path, method] of[
            ["/1", "GET"], ["/1", "PUT"], ["/1/membership", "GET"]
        ]) {
        const response = await request(
            "/api/customers" + path, { method, token: null }
        );

        assert.equal(response.status, 401);
        assert.match(
            response.headers.get("www-authenticate"),
            /^Bearer/
        );
        assert.equal(
            response.headers.get("cache-control"),
            "no-store"
        );
    }

    assert.equal(calls.length, 0);
});

test("GET returns public fields and forwards the verified token", async() => {
    const response = await request("/api/customers/1");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
        uid: 1,
        fullname: "Original",
        mid: 1
    });

    assert.equal(
        response.headers.get("cache-control"),
        "no-store"
    );

    assert.equal(calls[0].token, "owner.test.token");
});

test("PUT and membership responses follow the API contract", async() => {
    const updated = await request("/api/customers/1", {
        method: "PUT",
        body: { fullname: "  Sang Tuyet  " }
    });

    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body, {
        message: "Customer updated successfully",
        uid: 1
    });

    assert.equal(
        (await request("/api/customers/1")).body.fullname,
        "Sang Tuyet"
    );

    assert.deepEqual(
        (await request("/api/customers/1/membership")).body, { mid: 1, mname: "normal", score: 0 }
    );
});

test("ownership and membership changes cannot be spoofed", async() => {
    for (const path of[
            "/api/customers/2",
            "/api/customers/2/membership"
        ]) {
        const response = await request(path, {
            headers: {
                "X-User-Role": "admin",
                "X-User-Id": "99"
            }
        });

        assert.equal(response.status, 403);
    }

    assert.equal(
        (await request("/api/customers/2", {
            method: "PUT",
            body: { fullname: "Hacked" }
        })).status,
        403
    );

    assert.equal(
        (await request("/api/customers/1", {
            method: "PUT",
            body: { fullname: "Rejected", mid: 2 }
        })).status,
        403
    );

    assert.equal(rows.get(1).fullname, "Original");
    assert.equal(calls.length, 0);

    assert.equal(
        (await request("/api/customers/1", {
            method: "PUT",
            token: "admin.test.token",
            body: { mid: 2 }
        })).status,
        200
    );

    assert.equal(rows.get(1).mid, 2);
    assert.equal(rows.get(1).fullname, "Original");
});

test("invalid IDs are rejected before protobuf conversion", async() => {
    for (const uid of[
            "0",
            "01",
            "1.2",
            "1e0",
            "2147483648",
            "abc"
        ]) {
        const response = await request(
            `/api/customers/${uid}`, { token: "admin.test.token" }
        );

        assert.equal(response.status, 400);
    }

    assert.equal(calls.length, 0);
});

test("invalid JSON data and unsupported fields are rejected", async() => {
    for (const body of[{}, [],
            null, { uid: 2 }, { role: "admin" }, { fullname: 123 }, { fullname: null }, { fullname: " " }, { fullname: "x".repeat(101) }, { fullname: "a\0b" }, { mid: "2" }, { mid: 1.5 }, { mid: 2147483648 }
        ]) {
        const response = await request("/api/customers/1", {
            method: "PUT",
            token: "admin.test.token",
            body
        });

        assert.equal(response.status, 400);
    }

    assert.equal(calls.length, 0);
});

test("content type, malformed JSON and body size are checked", async() => {
    assert.equal(
        (await request("/api/customers/1", {
            method: "PUT",
            body: { fullname: "Sang" },
            headers: { "Content-Type": "text/plain" }
        })).status,
        415
    );

    assert.equal(
        (await request("/api/customers/1", {
            method: "PUT",
            raw: "{"
        })).status,
        400
    );

    assert.equal(
        (await request("/api/customers/1", {
            method: "PUT",
            body: { fullname: "x".repeat(17000) }
        })).status,
        413
    );

    assert.equal(calls.length, 0);
});

test("upstream failures preserve HTTP status without leaking details", async() => {
    for (const status of[401, 404, 500, 502, 503, 504]) {
        const response = await request(
            `/api/customers/${status}`, { token: "admin.test.token" }
        );

        assert.equal(response.status, status);

        assert.equal(
            JSON.stringify(response.body)
            .includes("sensitive backend"),
            false
        );

        assert.equal(
            response.body.requestId,
            "customer-test"
        );

        if (status === 401) {
            assert.match(
                response.headers.get("www-authenticate"),
                /^Bearer/
            );
        }
    }
});