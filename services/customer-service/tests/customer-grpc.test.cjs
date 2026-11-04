const test = require("node:test");
const assert = require("node:assert/strict");

const { grpc, ecommerce } = require("../src/infrastructure/proto");
const { createAuthClient } = require("../src/infrastructure/auth-client");
const { createCustomerHandlers } = require("../src/interfaces/grpc/customer-handlers");
const { createCustomerUseCases } = require("../src/application/customer-use-cases");
const { CustomerError } = require("../src/domain/customer-error");

function createTestApp() {
    const customers = new Map([
        [1, { uid: 1, fullname: null, mid: 1 }],
        [2, { uid: 2, fullname: "Second", mid: 1 }]
    ]);

    const memberships = new Map([
        [1, { mid: 1, mname: "normal", score: 10 }]
    ]);

    const copy = row => row ? {...row } : null;

    const update = (rows, id, patch) => {
        if (!rows.has(id)) return null;
        rows.set(id, {...rows.get(id), ...patch });
        return copy(rows.get(id));
    };

    return createCustomerUseCases({
        customers: {
            async ensure(input) {
                if (!customers.has(input.uid)) {
                    customers.set(input.uid, {...input, mid: 1 });
                }
                return copy(customers.get(input.uid));
            },

            async findById(uid) {
                if (uid === 500) {
                    throw new Error("sensitive SQL details");
                }
                if (uid === 501) {
                    throw Object.assign(
                        new Error("offline"), { code: "ECONNREFUSED" }
                    );
                }
                return copy(customers.get(uid));
            },

            async update(uid, patch) {
                return update(customers, uid, patch);
            }
        },

        memberships: {
            async findById(mid) {
                return copy(memberships.get(mid));
            },

            async list() {
                return Array.from(memberships.values(), copy);
            },

            async create(input) {
                const duplicate = Array.from(memberships.values()).some(
                    row => row.mname.toLowerCase() === input.mname.toLowerCase()
                );

                if (duplicate) {
                    throw new CustomerError(
                        "CONFLICT",
                        "Membership name already exists"
                    );
                }

                const row = { mid: memberships.size + 1, ...input };
                memberships.set(row.mid, row);
                return copy(row);
            },

            async update(mid, patch) {
                return update(memberships, mid, patch);
            }
        }
    });
}

function bind(server) {
    return new Promise((resolve, reject) => {
        server.bindAsync(
            "127.0.0.1:0",
            grpc.ServerCredentials.createInsecure(),
            (error, port) => {
                if (error) reject(error);
                else resolve(`127.0.0.1:${port}`);
            }
        );
    });
}

test("Customer gRPC boundary", { timeout: 20000 }, async t => {
    const authServer = new grpc.Server();
    const customerServer = new grpc.Server();
    const logs = [];

    const secret = "a".repeat(64); // Test fixture only.

    let authClient;
    let client;
    let lastAuthDeadline;

    t.after(() => {
        if (client) client.close();
        if (authClient) authClient.close();
        customerServer.forceShutdown();
        authServer.forceShutdown();
    });

    // Fake Auth Service; token signatures are not tested here.
    authServer.addService(ecommerce.auth.AuthService.service, {
        verifyToken(call, callback) {
            lastAuthDeadline = Number(call.getDeadline());
            const token = call.request.access_token;

            if (token === "hang.test.token") return;

            if (token === "down.test.token") {
                return callback({
                    code: grpc.status.UNAVAILABLE,
                    details: "offline"
                });
            }

            const role =
                token === "owner.test.token" ? "normal" :
                token === "admin.test.token" ? "admin" :
                null;

            if (!role) {
                return callback({
                    code: grpc.status.UNAUTHENTICATED,
                    details: "invalid"
                });
            }

            callback(null, {
                uid: role === "admin" ? 99 : 1,
                role
            });
        }
    });

    authClient = createAuthClient(await bind(authServer));

    customerServer.addService(
        ecommerce.customer.CustomerService.service,
        createCustomerHandlers({
            app: createTestApp(),
            verifyToken: authClient.verifyToken,
            provisioningSecret: secret,
            logger: {
                error: message => logs.push(message)
            }
        })
    );

    client = new ecommerce.customer.CustomerService(
        await bind(customerServer),
        grpc.credentials.createInsecure()
    );

    function metadata(token) {
        const result = new grpc.Metadata();

        if (token) {
            result.set("authorization", `Bearer ${token}`);
        }

        return result;
    }

    const owner = metadata("owner.test.token");
    const admin = metadata("admin.test.token");

    function rpc(method, input, headers = new grpc.Metadata()) {
        return new Promise((resolve, reject) => {
            client[method](
                input,
                headers, { deadline: new Date(Date.now() + 5000) },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );
        });
    }

    await t.test("missing or invalid authentication is rejected", async() => {
        for (const method of[
                "getCustomer",
                "updateCustomer",
                "getMembership",
                "listMemberships",
                "createMembership",
                "updateMembership"
            ]) {
            await assert.rejects(
                rpc(method, {}), { code: grpc.status.UNAUTHENTICATED }
            );
        }

        await assert.rejects(
            rpc("getCustomer", { uid: 1 }, metadata("bad.test.token")), { code: 16 }
        );

        const combined = new grpc.Metadata();

        combined.set(
            "authorization",
            "Bearer owner.test.token, Bearer admin.test.token"
        );

        await assert.rejects(
            rpc("getCustomer", { uid: 1 }, combined), { code: 16 }
        );
    });

    await t.test("owner reads profile and membership", async() => {
        assert.deepEqual(
            await rpc("getCustomer", { uid: 1 }, owner), { uid: 1, fullname: "", mid: 1 }
        );

        assert.deepEqual(
            await rpc("getMembership", { uid: 1 }, owner), { mid: 1, mname: "normal", score: 10 }
        );

        assert.equal(
            (await rpc("listMemberships", {}, owner)).items.length,
            1
        );

        assert.ok(Number.isFinite(lastAuthDeadline));
    });

    await t.test("spoofed metadata cannot grant admin access", async() => {
        const spoofed = metadata("owner.test.token");
        spoofed.set("x-user-id", "99");
        spoofed.set("x-user-role", "admin");

        await assert.rejects(
            rpc("getCustomer", { uid: 2 }, spoofed), { code: 7 }
        );

        await assert.rejects(
            rpc("getMembership", { uid: 2 }, owner), { code: 7 }
        );

        await assert.rejects(
            rpc(
                "updateCustomer", { uid: 1, fullname: "Rejected", mid: 1 },
                owner
            ), { code: 7 }
        );

        assert.equal(
            (await rpc("getCustomer", { uid: 1 }, owner)).fullname,
            ""
        );

        assert.equal(
            (await rpc("getCustomer", { uid: 2 }, admin)).uid,
            2
        );
    });

    await t.test("optional update fields survive protobuf correctly", async() => {
        assert.deepEqual(
            await rpc(
                "updateCustomer", { uid: 1, fullname: "Sang Tuyet" },
                owner
            ), { uid: 1, fullname: "Sang Tuyet", mid: 1 }
        );

        const membership = await rpc(
            "createMembership", { mname: "trial", score: 0 },
            admin
        );

        assert.equal(membership.score, 0);

        await rpc(
            "updateMembership", { mid: membership.mid, score: 20 },
            admin
        );

        await rpc(
            "updateMembership", { mid: membership.mid, score: 0 },
            admin
        );

        await rpc(
            "updateMembership", { mid: membership.mid, mname: "renamed" },
            admin
        );

        await rpc(
            "updateCustomer", { uid: 1, mid: membership.mid },
            admin
        );

        assert.deepEqual(
            await rpc("getMembership", { uid: 1 }, owner), { mid: membership.mid, mname: "renamed", score: 0 }
        );

        assert.equal(
            (await rpc("getCustomer", { uid: 1 }, owner)).fullname,
            "Sang Tuyet"
        );

        await assert.rejects(
            rpc("createMembership", { mname: "vip", score: 99 }, owner), { code: 7 }
        );
    });

    await t.test("validation, not found and conflict have correct statuses", async() => {
        await assert.rejects(
            rpc("getCustomer", { uid: 0 }, admin), { code: 3 }
        );

        await assert.rejects(
            rpc("getCustomer", { uid: 999 }, admin), { code: 5 }
        );

        await assert.rejects(
            rpc("updateCustomer", { uid: 1 }, owner), { code: 3 }
        );

        await assert.rejects(
            rpc("createMembership", { mname: "NORMAL", score: 10 }, admin), { code: 6 }
        );
    });

    await t.test("provisioning requires its own service credential", async() => {
        await assert.rejects(
            rpc("ensureCustomer", { uid: 3 }, admin), { code: 16 }
        );

        const headers = new grpc.Metadata();
        headers.set("x-provisioning-key", "b".repeat(64));

        await assert.rejects(
            rpc("ensureCustomer", { uid: 3 }, headers), { code: 16 }
        );

        headers.set("x-provisioning-key", secret);

        assert.deepEqual(
            await rpc("ensureCustomer", { uid: 3 }, headers), { uid: 3, fullname: "", mid: 1 }
        );

        await rpc(
            "updateCustomer", { uid: 3, fullname: "Preserved" },
            admin
        );

        assert.equal(
            (
                await rpc(
                    "ensureCustomer", { uid: 3, fullname: "Retry" },
                    headers
                )
            ).fullname,
            "Preserved"
        );
    });

    await t.test("dependency failures and internal errors are sanitized", async() => {
        await assert.rejects(
            rpc("getCustomer", { uid: 1 }, metadata("down.test.token")), { code: 14 }
        );

        await assert.rejects(
            rpc("getCustomer", { uid: 501 }, admin), { code: 14 }
        );

        await assert.rejects(
            rpc("getCustomer", { uid: 500 }, admin), { code: 13, details: "Internal server error" }
        );

        assert.equal(
            logs.some(message => message.includes("sensitive SQL")),
            false
        );
    });

    await t.test("Auth calls stop waiting at their deadline", async() => {
        await assert.rejects(
            authClient.verifyToken(
                "hang.test.token",
                new Date(Date.now() + 100)
            ), { code: "AUTH_TIMEOUT" }
        );
    });
});