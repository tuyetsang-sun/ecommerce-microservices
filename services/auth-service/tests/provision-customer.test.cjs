const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createCustomerProvisioner
} = require("../src/application/provision-customer");

const {
    createCustomerClient
} = require("../src/infrastructure/customer-client");

const {
    grpc,
    ecommerce
} = require("../src/infrastructure/proto");

function setup(attempts = 1) {
    const calls = [];

    const jobs = {
        async claimNext() {
            return { uid: 7, fullname: "Sang", attempts };
        },

        async complete(...args) {
            calls.push(["complete", ...args]);
            return true;
        },

        async retry(...args) {
            calls.push(["retry", ...args]);
            return true;
        }
    };

    const ensureCustomer = async input => {
        calls.push(["ensure", input]);
    };

    return { jobs, calls, ensureCustomer };
}

test("empty queue does not call Customer", async() => {
    const state = setup();
    state.jobs.claimNext = async() => null;

    assert.deepEqual(
        await createCustomerProvisioner(state).runOnce(), { status: "idle" }
    );

    assert.deepEqual(state.calls, []);
});

test("mark complete only after Customer confirms", async() => {
    const state = setup();

    assert.equal(
        (await createCustomerProvisioner(state).runOnce()).status,
        "done"
    );

    assert.deepEqual(state.calls, [
        ["ensure", { uid: 7, fullname: "Sang" }],
        ["complete", 7, 1]
    ]);
});

test("failed calls retry with bounded backoff", async() => {
    for (const [attempt, delay] of[
            [1, 1000], [2, 2000], [6, 32000], [7, 60000], [20, 60000]
        ]) {
        const state = setup(attempt);

        state.ensureCustomer = async() => {
            throw Object.assign(
                new Error("offline"), { code: 14 }
            );
        };

        assert.equal(
            (await createCustomerProvisioner(state).runOnce()).status,
            "retry"
        );

        assert.deepEqual(state.calls, [
            ["retry", 7, attempt, delay]
        ]);
    }
});

test("old attempt cannot report successful completion", async() => {
    const state = setup();
    state.jobs.complete = async() => false;

    assert.equal(
        (await createCustomerProvisioner(state).runOnce()).status,
        "stale"
    );
});

test("database completion failure is preserved for lease recovery", async() => {
    const state = setup();
    const failure = new Error("database unavailable");

    state.jobs.complete = async() => {
        throw failure;
    };

    await assert.rejects(
        createCustomerProvisioner(state).runOnce(),
        error => error === failure
    );

    assert.equal(
        state.calls.some(call => call[0] === "retry"),
        false
    );
});

test("Customer client sends credential and validates acknowledgement", async t => {
    const server = new grpc.Server();
    const key = "a".repeat(64); // Test fixture only.
    const seen = [];

    let client;

    t.after(() => {
        if (client) client.close();
        server.forceShutdown();
    });

    server.addService(ecommerce.customer.CustomerService.service, {
        ensureCustomer(call, callback) {
            seen.push({
                key: call.metadata.get("x-provisioning-key")[0],
                deadline: Number(call.getDeadline())
            });

            if (call.request.uid === 8) {
                return callback({
                    code: 14,
                    details: "offline"
                });
            }

            callback(null, {
                uid: call.request.uid === 9 ? 99 : call.request.uid,
                mid: 1
            });
        }
    });

    const port = await new Promise((resolve, reject) => {
        server.bindAsync(
            "127.0.0.1:0",
            grpc.ServerCredentials.createInsecure(),
            (error, bound) => {
                if (error) reject(error);
                else resolve(bound);
            }
        );
    });

    client = createCustomerClient(
        `127.0.0.1:${port}`,
        key
    );

    assert.equal(
        (await client.ensureCustomer({ uid: 7, fullname: null })).uid,
        7
    );

    assert.equal(seen[0].key, key);
    assert.ok(Number.isFinite(seen[0].deadline));

    await assert.rejects(
        client.ensureCustomer({ uid: 8 }), { code: 14 }
    );

    await assert.rejects(
        client.ensureCustomer({ uid: 9 }), { code: "INVALID_CUSTOMER_RESPONSE" }
    );
});