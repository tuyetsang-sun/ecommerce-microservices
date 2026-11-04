const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
const express = require("express");

const {
    connectRedis,
    executeRedis,
    closeRedis
} = require("../src/clients/redis");

const { createRateLimit } = require("../src/middlewares/rate-limit");
const { errorHandler } = require("../src/middlewares/error-handler");

const scope = `test:${randomUUID()}`;
const digest = createHash("sha256")
    .update("127.0.0.1")
    .digest("hex");

const key = `rl:v1:${scope}:${digest}`;
const servers = [];

async function startServer() {
    const app = express();
    app.set("trust proxy", false);

    app.get("/probe", createRateLimit({
        executeRedis,
        scope,
        limit: 3,
        windowMs: 5000
    }), (req, res) => res.json({ ok: true }));

    app.use(errorHandler);

    const server = await new Promise(resolve => {
        const listening = app.listen(
            0,
            "127.0.0.1",
            () => resolve(listening)
        );
    });

    servers.push(server);

    return `http://127.0.0.1:${server.address().port}/probe`;
}

async function request(url, index = 1) {
    const response = await fetch(url, {
        headers: {
            "X-Forwarded-For": `198.51.100.${index}`
        },
        signal: AbortSignal.timeout(5000)
    });

    await response.json();
    return response;
}

async function main() {
    let connectTimer;

    try {
        await Promise.race([
            connectRedis(),
            new Promise((_, reject) => {
                connectTimer = setTimeout(
                    () => reject(new Error("Redis connect timeout")),
                    10000
                );
            })
        ]);
    } finally {
        clearTimeout(connectTimer);
    }

    const urls = [
        await startServer(),
        await startServer()
    ];

    const responses = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
            request(urls[index % 2], index + 1)
        )
    );

    assert.equal(
        responses.filter(response => response.status === 200).length,
        3
    );

    assert.equal(
        responses.filter(response => response.status === 429).length,
        17
    );

    for (const response of responses.filter(r => r.status === 429)) {
        assert.ok(Number(response.headers.get("Retry-After")) >= 1);
        assert.equal(response.headers.get("X-RateLimit-Remaining"), "0");
    }

    console.log(
        "OK: Two HTTP servers share one Redis counter; 3 allowed, 17 blocked"
    );
    console.log(
        "OK: Changing X-Forwarded-For does not bypass the limit"
    );

    const ttlBefore = await executeRedis(redis => redis.pTTL(key));
    assert.ok(ttlBefore > 0 && ttlBefore <= 5000);

    await delay(100);

    assert.equal((await request(urls[0])).status, 429);

    const ttlAfter = await executeRedis(redis => redis.pTTL(key));
    assert.ok(ttlAfter > 0 && ttlAfter < ttlBefore);

    await delay(ttlAfter + 100);

    assert.equal((await request(urls[0])).status, 200);

    console.log(
        "OK: Requests do not extend the window; access resumes after expiry"
    );
    console.log("RATE LIMIT CHECK PASSED");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(async() => {
    await Promise.all(servers.map(server =>
        new Promise(resolve => {
            server.close(resolve);
            server.closeAllConnections();
        })
    ));

    try {
        await executeRedis(redis => redis.del(key));
    } catch {
        // Test keys also expire automatically.
    }

    closeRedis();
});