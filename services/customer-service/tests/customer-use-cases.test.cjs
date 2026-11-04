const test = require("node:test");
const assert = require("node:assert/strict");

const { CustomerError } = require("../src/domain/customer-error");
const {
    createCustomerUseCases
} = require("../src/application/customer-use-cases");

const normal = { uid: 1, role: "normal" };
const admin = { uid: 99, role: "admin" };

const hasCode = code => error =>
    error instanceof CustomerError && error.code === code;

function setup() {
    const customerRows = new Map([
        [1, { uid: 1, fullname: "Customer One", mid: 1 }],
        [2, { uid: 2, fullname: "Customer Two", mid: 2 }]
    ]);

    const membershipRows = new Map([
        [1, { mid: 1, mname: "normal", score: 10 }],
        [2, { mid: 2, mname: "silver", score: 20 }]
    ]);

    let nextMid = 3;

    const copy = value => value ? {...value } : null;

    const update = (rows, id, patch) => {
        if (!rows.has(id)) return null;

        rows.set(id, {...rows.get(id), ...patch });
        return copy(rows.get(id));
    };

    const customers = {
        async ensure(input) {
            if (!customerRows.has(input.uid)) {
                customerRows.set(input.uid, {...input, mid: 1 });
            }

            return copy(customerRows.get(input.uid));
        },

        async findById(uid) {
            return copy(customerRows.get(uid));
        },

        async update(uid, patch) {
            return update(customerRows, uid, patch);
        }
    };

    const memberships = {
        async findById(mid) {
            return copy(membershipRows.get(mid));
        },

        async list() {
            return Array.from(membershipRows.values(), copy);
        },

        async create(input) {
            const row = { mid: nextMid++, ...input };

            membershipRows.set(row.mid, row);
            return copy(row);
        },

        async update(mid, patch) {
            return update(membershipRows, mid, patch);
        }
    };

    return {
        app: createCustomerUseCases({ customers, memberships }),
        customers
    };
}

test("1. Protected use cases require an authenticated actor", async() => {
    const { app } = setup();

    const calls = [
        () => app.getCustomer({ uid: 1 }),
        () => app.updateCustomer({ uid: 1, fullname: "New Name" }),
        () => app.getMembership({ uid: 1 }),
        () => app.listMemberships(),
        () => app.createMembership({ mname: "gold", score: 30 }),
        () => app.updateMembership({ mid: 1, score: 20 })
    ];

    for (const call of calls) {
        await assert.rejects(call, hasCode("UNAUTHENTICATED"));
    }
});

test("2. Owner reads profile and membership; admin reads other profiles", async() => {
    const { app } = setup();

    assert.equal(
        (await app.getCustomer({ uid: 1 }, normal)).fullname,
        "Customer One"
    );

    assert.deepEqual(await app.getMembership({ uid: 1 }, normal), {
        mid: 1,
        mname: "normal",
        score: 10
    });

    assert.equal((await app.getCustomer({ uid: 2 }, admin)).uid, 2);
    assert.equal((await app.listMemberships(normal)).length, 2);
});

test("3. Normal user cannot access another customer or spoof body role", async() => {
    const { app } = setup();

    await assert.rejects(
        () => app.getCustomer({ uid: 2, role: "admin" }, normal),
        hasCode("FORBIDDEN")
    );

    await assert.rejects(
        () => app.getMembership({ uid: 2 }, normal),
        hasCode("FORBIDDEN")
    );

    await assert.rejects(
        () => app.updateCustomer({ uid: 2, fullname: "Hacked" }, normal),
        hasCode("FORBIDDEN")
    );
});

test("4. Owner updates fullname, but cannot change membership", async() => {
    const { app } = setup();

    assert.deepEqual(
        await app.updateCustomer({ uid: 1, fullname: "  Sang Tuyet  " },
            normal
        ), { uid: 1, fullname: "Sang Tuyet", mid: 1 }
    );

    await assert.rejects(
        () => app.updateCustomer({ uid: 1, fullname: "Rejected", mid: 2 },
            normal
        ),
        hasCode("FORBIDDEN")
    );

    assert.equal(
        (await app.getCustomer({ uid: 1 }, normal)).fullname,
        "Sang Tuyet"
    );
});

test("5. Only admin changes customer membership, which must exist", async() => {
    const { app } = setup();

    assert.equal(
        (await app.updateCustomer({ uid: 1, mid: 2 }, admin)).mid,
        2
    );

    assert.equal(
        (await app.getMembership({ uid: 1 }, normal)).score,
        20
    );

    await assert.rejects(
        () => app.updateCustomer({ uid: 1, mid: 999 }, admin),
        hasCode("VALIDATION_ERROR")
    );

    assert.equal((await app.getCustomer({ uid: 1 }, normal)).mid, 2);
});

test("6. Admin creates and updates memberships; zero score is valid", async() => {
    const { app } = setup();

    const created = await app.createMembership({ mname: "  trial  ", score: 0 },
        admin
    );

    assert.equal(created.mname, "trial");
    assert.equal(created.score, 0);

    assert.deepEqual(
        await app.updateMembership({ mid: created.mid, mname: "gold", score: 30 },
            admin
        ), { mid: created.mid, mname: "gold", score: 30 }
    );

    await assert.rejects(
        () => app.createMembership({ mname: "vip", score: 50 }, normal),
        hasCode("FORBIDDEN")
    );

    await assert.rejects(
        () => app.updateMembership({ mid: 1, score: 50 }, normal),
        hasCode("FORBIDDEN")
    );
});

test("7. Reject invalid ids, fullname, and empty updates", async() => {
    const { app } = setup();

    for (const uid of[0, -1, 1.5, "1", 2147483648]) {
        await assert.rejects(
            () => app.getCustomer({ uid }, admin),
            hasCode("VALIDATION_ERROR")
        );
    }

    for (const fullname of[
            "",
            "   ",
            null,
            123,
            "x".repeat(101),
            "a\0b"
        ]) {
        await assert.rejects(
            () => app.updateCustomer({ uid: 1, fullname }, normal),
            hasCode("VALIDATION_ERROR")
        );
    }

    await assert.rejects(
        () => app.updateCustomer({ uid: 1 }, normal),
        hasCode("VALIDATION_ERROR")
    );

    await assert.rejects(
        () => app.updateMembership({ mid: 1 }, admin),
        hasCode("VALIDATION_ERROR")
    );
});

test("8. Reject invalid membership names and scores", async() => {
    const { app } = setup();

    for (const score of[-1, 1.5, "10", null, 2147483648]) {
        await assert.rejects(
            () => app.createMembership({ mname: "gold", score }, admin),
            hasCode("VALIDATION_ERROR")
        );

        await assert.rejects(
            () => app.updateMembership({ mid: 1, score }, admin),
            hasCode("VALIDATION_ERROR")
        );
    }

    for (const mname of["", " ", "x".repeat(51), null]) {
        await assert.rejects(
            () => app.createMembership({ mname, score: 10 }, admin),
            hasCode("VALIDATION_ERROR")
        );
    }
});

test("9. Missing customers and memberships produce NOT_FOUND", async() => {
    const { app } = setup();

    await assert.rejects(
        () => app.getCustomer({ uid: 999 }, admin),
        hasCode("NOT_FOUND")
    );

    await assert.rejects(
        () => app.updateCustomer({ uid: 999, fullname: "Nobody" }, admin),
        hasCode("NOT_FOUND")
    );

    await assert.rejects(
        () => app.updateMembership({ mid: 999, score: 10 }, admin),
        hasCode("NOT_FOUND")
    );
});

test("10. Provisioning forwards only uid and fullname", async() => {
    const { app, customers } = setup();

    let forwarded;
    const ensure = customers.ensure;

    customers.ensure = async input => {
        forwarded = input;
        return ensure(input);
    };

    const created = await app.ensureCustomer({
        uid: 3,
        fullname: "  New User  ",
        mid: 2,
        score: 999
    });

    assert.deepEqual(forwarded, {
        uid: 3,
        fullname: "New User"
    });

    assert.deepEqual(created, {
        uid: 3,
        fullname: "New User",
        mid: 1
    });

    assert.equal(
        (await app.ensureCustomer({ uid: 4 })).fullname,
        null
    );
});

test("11. Infrastructure failures are not disguised as missing customers", async() => {
    const { app, customers } = setup();

    const failure = new Error("Database unavailable");

    customers.findById = async() => {
        throw failure;
    };

    await assert.rejects(
        () => app.getCustomer({ uid: 1 }, normal),
        error => error === failure
    );
});