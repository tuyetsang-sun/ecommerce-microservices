const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { setTimeout: pause } = require("node:timers/promises");

const baseUrl =
    process.env.BASE_URL ||
    `http://127.0.0.1:${process.env.PORT || 3000}`;

async function request(method, path, token, body) {
    const headers = {};

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    if (body !== undefined) {
        headers["Content-Type"] = "application/json";
    }

    const response = await fetch(baseUrl + path, {
        method,
        headers,
        body: body === undefined ?
            undefined :
            JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
    });

    return {
        status: response.status,
        headers: response.headers,
        body: await response.json()
    };
}

function expectStatus(response, expected) {
    assert.equal(
        response.status,
        expected,
        `Expected HTTP ${expected}, received ${response.status}`
    );
}

async function createAccount(label) {
    const credentials = {
        username: "p3cus_" + randomBytes(6).toString("hex"),
        password: randomBytes(16).toString("hex")
    };

    const registered = await request(
        "POST",
        "/api/auth/register",
        null, {
            ...credentials,
            fullname: label
        }
    );

    expectStatus(registered, 201);

    const login = await request(
        "POST",
        "/api/auth/login",
        null,
        credentials
    );

    expectStatus(login, 200);
    assert.equal(typeof login.body.accessToken, "string");

    return {
        uid: registered.body.uid,
        token: login.body.accessToken,
        fullname: label
    };
}

async function waitForProfile(account) {
    const deadline = Date.now() + 90000;

    while (Date.now() < deadline) {
        const response = await request(
            "GET",
            `/api/customers/${account.uid}`,
            account.token
        );

        if (response.status === 200) {
            return response;
        }

        expectStatus(response, 404);
        await pause(1000);
    }

    throw new Error(
        "Customer profile was not provisioned within 90 seconds"
    );
}

async function main() {
    const first = await createAccount("Customer HTTP One");
    const second = await createAccount("Customer HTTP Two");

    const path = `/api/customers/${first.uid}`;

    const original = await waitForProfile(first);
    await waitForProfile(second);

    assert.deepEqual(original.body, {
        uid: first.uid,
        fullname: first.fullname,
        mid: 1
    });

    assert.equal(
        original.headers.get("cache-control"),
        "no-store"
    );

    assert.ok(original.headers.get("x-request-id"));

    console.log(
        "OK: register, login and read provisioned profile through Gateway"
    );

    const anonymous = await request("GET", path);

    expectStatus(anonymous, 401);
    assert.match(
        anonymous.headers.get("www-authenticate"),
        /^Bearer/
    );

    expectStatus(
        await request("GET", path, "invalid.token.value"),
        401
    );

    expectStatus(
        await request("GET", path, second.token),
        403
    );

    expectStatus(
        await request(
            "GET",
            path + "/membership",
            second.token
        ),
        403
    );

    expectStatus(
        await request(
            "PUT",
            path,
            second.token, { fullname: "Forbidden" }
        ),
        403
    );

    console.log(
        "OK: missing/invalid token returns 401; another customer is forbidden"
    );

    const changed = await request(
        "PUT",
        path,
        first.token, { fullname: "Sang REST Test" }
    );

    expectStatus(changed, 200);

    assert.deepEqual(changed.body, {
        message: "Customer updated successfully",
        uid: first.uid
    });

    assert.deepEqual(
        (await request("GET", path, first.token)).body, {
            uid: first.uid,
            fullname: "Sang REST Test",
            mid: 1
        }
    );

    console.log(
        "OK: fullname update is stored and response matches the API contract"
    );

    const membership = await request(
        "GET",
        path + "/membership",
        first.token
    );

    expectStatus(membership, 200);
    assert.equal(membership.body.mid, 1);
    assert.equal(typeof membership.body.mname, "string");

    assert.ok(
        Number.isInteger(membership.body.score) &&
        membership.body.score >= 0
    );

    console.log(
        "OK: membership returns mid, mname and score"
    );

    expectStatus(
        await request(
            "PUT",
            path,
            first.token, { fullname: "Rejected", mid: 1 }
        ),
        403
    );

    expectStatus(
        await request(
            "PUT",
            path,
            first.token, { role: "admin" }
        ),
        400
    );

    expectStatus(
        await request(
            "PUT",
            path,
            first.token, { fullname: " " }
        ),
        400
    );

    assert.equal(
        (await request("GET", path, first.token)).body.fullname,
        "Sang REST Test"
    );

    console.log(
        "OK: forbidden and invalid updates leave the profile unchanged"
    );

    console.log(
        `CUSTOMER HTTP CHECK PASSED: uid1=${first.uid}, uid2=${second.uid}`
    );
}

main().catch(error => {
    console.error(
        "CUSTOMER HTTP CHECK FAILED:",
        error.message
    );

    process.exitCode = 1;
});