const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomBytes } = require("node:crypto");

const baseUrl = "http://127.0.0.1:" + (process.env.PORT || "3000");

async function request(method, path, token, body, expected) {
    const headers = {};

    if (token) headers.Authorization = "Bearer " + token;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const response = await fetch(baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
    });

    assert.equal(response.status, expected, method + " " + path);
    return response.json();
}

async function main() {
    const username = (process.argv[2] || "").trim();
    const password = fs.readFileSync(0, "utf8");

    assert.ok(
        username && password,
        "Admin username and stdin password are required"
    );

    const adminLogin = await request(
        "POST",
        "/api/auth/login",
        null, { username, password },
        200
    );

    const admin = adminLogin.accessToken;

    const me = await request(
        "GET", "/api/auth/me", admin, undefined, 200
    );

    assert.equal(
        me.role,
        "admin",
        "Use the admin account from the previous step"
    );

    const suffix = randomBytes(6).toString("hex");

    const account = {
        username: "p3member_" + suffix,
        password: randomBytes(16).toString("hex")
    };

    const registered = await request(
        "POST", "/api/auth/register", null, account, 201
    );

    const normalLogin = await request(
        "POST", "/api/auth/login", null, account, 200
    );

    const normal = normalLogin.accessToken;

    const normalIdentity = await request(
        "GET", "/api/auth/me", normal, undefined, 200
    );

    assert.equal(normalIdentity.role, "normal");

    const path = "/api/memberships";

    await request("GET", path, null, undefined, 401);

    await request(
        "POST", path, null, { mname: "blocked", score: 10 }, 401
    );

    await request("PUT", path + "/1", null, { score: 10 }, 401);

    await request(
        "POST", path, normal, { mname: "blocked", score: 10 }, 403
    );

    await request("PUT", path + "/1", normal, { score: 10 }, 403);

    const initial = await request(
        "GET", path, normal, undefined, 200
    );

    assert.ok(Array.isArray(initial.items));

    console.log("OK: anonymous 401, normal read 200 and write 403");

    const mname = "test_" + suffix;

    const created = await request(
        "POST", path, admin, { mname, score: 25 }, 201
    );

    assert.ok(Number.isInteger(created.mid) && created.mid > 0);
    assert.equal(created.mname, mname);
    assert.equal(created.score, 25);

    await request(
        "POST",
        path,
        admin, { mname: mname.toUpperCase(), score: 25 },
        409
    );

    const updated = await request(
        "PUT", path + "/" + created.mid, admin, { score: 0 }, 200
    );

    assert.deepEqual(updated, {
        mid: created.mid,
        mname,
        score: 0
    });

    for (const score of[-1, 1.5, "10", null, 2147483648]) {
        await request(
            "PUT", path + "/" + created.mid, admin, { score }, 400
        );
    }

    await request("POST", path, admin, { mname }, 400);

    await request(
        "POST", path, admin, { mname: " ", score: 10 }, 400
    );

    await request(
        "PUT", path + "/" + created.mid, admin, {}, 400
    );

    await request(
        "PUT",
        path + "/" + created.mid,
        admin, { score: 10, role: "admin" },
        400
    );

    await request("PUT", path + "/0", admin, { score: 10 }, 400);

    const listed = await request(
        "GET", path, normal, undefined, 200
    );

    assert.deepEqual(
        listed.items.find(item => item.mid === created.mid),
        updated
    );

    let missingMid = 2147483647;

    while (listed.items.some(item => item.mid === missingMid)) {
        missingMid--;
    }

    await request(
        "PUT", path + "/" + missingMid, admin, { score: 10 }, 404
    );

    console.log(
        "OK: create, duplicate 409, score 0, invalid input 400 and missing ID 404"
    );

    const customerPath = "/api/customers/" + registered.uid;
    const deadline = Date.now() + 90000;

    while (true) {
        const response = await fetch(baseUrl + customerPath, {
            headers: { Authorization: "Bearer " + normal },
            signal: AbortSignal.timeout(10000)
        });

        await response.arrayBuffer();

        if (response.status === 200) break;

        assert.equal(
            response.status,
            404,
            "Customer provisioning lookup"
        );

        assert.ok(
            Date.now() < deadline,
            "Customer provisioning timed out"
        );

        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    await request(
        "PUT", customerPath, normal, { mid: created.mid }, 403
    );

    await request(
        "PUT", customerPath, admin, { mid: created.mid }, 200
    );

    const membership = await request(
        "GET",
        customerPath + "/membership",
        normal,
        undefined,
        200
    );

    assert.deepEqual(membership, updated);

    console.log(
        "OK: admin assigns membership, customer reads the correct score"
    );

    console.log(
        "MEMBERSHIP HTTP CHECK PASSED: uid=" +
        registered.uid + ", mid=" + created.mid
    );
}

main().catch(error => {
    console.error("MEMBERSHIP HTTP CHECK FAILED:", error.message);
    process.exitCode = 1;
});