const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { Client, Pool } = require("pg");

const {
    createCustomerRepositories
} = require("../src/infrastructure/customer-repositories");

const {
    createCustomerUseCases
} = require("../src/application/customer-use-cases");

async function runChecks(db) {
    const repositories = createCustomerRepositories(db);
    const app = createCustomerUseCases(repositories);

    const admin = { uid: 900, role: "admin" };
    const owner = { uid: 101, role: "normal" };

    let silver;
    let passed = 0;

    async function check(label, action) {
        await action();
        passed += 1;
        console.log(`OK ${passed}: ${label}`);
    }

    await check("seed membership and default customer", async() => {
        assert.deepEqual(await app.listMemberships(owner), [
            { mid: 1, mname: "normal", score: 10 }
        ]);

        assert.deepEqual(await app.ensureCustomer({ uid: 101 }), {
            uid: 101,
            fullname: null,
            mid: 1
        });

        assert.deepEqual(await app.getCustomer({ uid: 101 }, owner), {
            uid: 101,
            fullname: null,
            mid: 1
        });
    });

    await check("save profile and membership", async() => {
        silver = await app.createMembership({ mname: "silver", score: 20 },
            admin
        );

        await app.updateCustomer({ uid: 101, fullname: "Sang Tuyet", mid: silver.mid },
            admin
        );

        assert.deepEqual(await app.getCustomer({ uid: 101 }, owner), {
            uid: 101,
            fullname: "Sang Tuyet",
            mid: silver.mid
        });

        assert.deepEqual(
            await app.getMembership({ uid: 101 }, owner),
            silver
        );
    });

    await check(
        "concurrent retries preserve existing profile",
        async() => {
            const before = await db.query(
                "SELECT created_at FROM public.customers WHERE uid = 101"
            );

            const results = await Promise.allSettled(
                Array.from({ length: 8 }, () =>
                    app.ensureCustomer({
                        uid: 101,
                        fullname: "Retry name"
                    })
                )
            );

            for (const result of results) {
                assert.equal(result.status, "fulfilled");

                assert.deepEqual(result.value, {
                    uid: 101,
                    fullname: "Sang Tuyet",
                    mid: silver.mid
                });
            }

            const after = await db.query(
                "SELECT created_at FROM public.customers WHERE uid = 101"
            );

            assert.deepEqual(after.rows, before.rows);

            const count = await db.query(
                `SELECT COUNT(*)::int AS total
         FROM public.customers
         WHERE uid = 101`
            );

            assert.equal(count.rows[0].total, 1);
        }
    );

    await check(
        "concurrent first creation produces one customer",
        async() => {
            const results = await Promise.allSettled(
                Array.from({ length: 8 }, () =>
                    app.ensureCustomer({
                        uid: 102,
                        fullname: "Concurrent"
                    })
                )
            );

            for (const result of results) {
                assert.equal(result.status, "fulfilled");

                assert.deepEqual(result.value, {
                    uid: 102,
                    fullname: "Concurrent",
                    mid: 1
                });
            }

            const count = await db.query(
                `SELECT COUNT(*)::int AS total
         FROM public.customers
         WHERE uid = 102`
            );

            assert.equal(count.rows[0].total, 1);
        }
    );

    await check("partial update and SQL-like text stay safe", async() => {
        const fullname = "O'Neil'); DROP TABLE public.customers; --";

        await app.updateCustomer({ uid: 101, fullname }, owner);

        assert.deepEqual(await app.getCustomer({ uid: 101 }, owner), {
            uid: 101,
            fullname,
            mid: silver.mid
        });

        assert.equal(
            (await app.getCustomer({ uid: 102 }, admin)).fullname,
            "Concurrent"
        );
    });

    await check(
        "membership partial update preserves zero score",
        async() => {
            assert.deepEqual(
                await app.updateMembership({ mid: silver.mid, score: 0 },
                    admin
                ), {
                    mid: silver.mid,
                    mname: "silver",
                    score: 0
                }
            );

            await app.updateMembership({ mid: silver.mid, mname: "silver-renamed" },
                admin
            );

            assert.deepEqual(
                await app.getMembership({ uid: 101 }, owner), {
                    mid: silver.mid,
                    mname: "silver-renamed",
                    score: 0
                }
            );
        }
    );

    await check(
        "concurrent duplicate membership returns CONFLICT",
        async() => {
            const results = await Promise.allSettled([
                app.createMembership({ mname: "gold", score: 30 },
                    admin
                ),
                app.createMembership({ mname: "GOLD", score: 30 },
                    admin
                )
            ]);

            const success = results.filter(
                (result) => result.status === "fulfilled"
            );

            const failure = results.filter(
                (result) => result.status === "rejected"
            );

            assert.equal(success.length, 1);
            assert.equal(failure.length, 1);
            assert.equal(failure[0].reason.code, "CONFLICT");

            const gold = success[0].value;

            await assert.rejects(
                app.updateMembership({ mid: gold.mid, mname: "SILVER-RENAMED" },
                    admin
                ), { code: "CONFLICT" }
            );

            assert.deepEqual(
                await repositories.memberships.findById(gold.mid),
                gold
            );
        }
    );

    await check("missing records and invalid membership", async() => {
        await assert.rejects(
            app.getCustomer({ uid: 9999 }, admin), { code: "NOT_FOUND" }
        );

        await assert.rejects(
            app.updateMembership({ mid: 9999, score: 0 }, admin), { code: "NOT_FOUND" }
        );

        assert.equal(
            await repositories.customers.update(
                9999, { fullname: "Missing" }
            ),
            null
        );

        const before = await app.getCustomer({ uid: 101 }, owner);

        // Check the FK error directly at repository level.
        await assert.rejects(
            repositories.customers.update(101, {
                fullname: "Must not persist",
                mid: 9999
            }), { code: "VALIDATION_ERROR" }
        );

        assert.deepEqual(
            await app.getCustomer({ uid: 101 }, owner),
            before
        );
    });

    await check("forbidden updates do not change stored data", async() => {
        const before = await app.getCustomer({ uid: 101 }, owner);

        await assert.rejects(
            app.updateCustomer({ uid: 101, fullname: "Forbidden", mid: 1 },
                owner
            ), { code: "FORBIDDEN" }
        );

        await assert.rejects(
            app.getCustomer({ uid: 102 }, owner), { code: "FORBIDDEN" }
        );

        assert.deepEqual(
            await app.getCustomer({ uid: 101 }, owner),
            before
        );
    });

    await check("unexpected database errors are preserved", async() => {
        const failure = new Error("database connection lost");

        const broken = createCustomerRepositories({
            query: async() => {
                throw failure;
            }
        });

        await assert.rejects(
            broken.customers.findById(101),
            (error) => error === failure
        );
    });
}

async function main() {
    for (const key of[
            "PGHOST",
            "PGDATABASE",
            "PGUSER",
            "PGPASSWORD"
        ]) {
        if (!process.env[key]) {
            throw new Error(`Missing ${key}`);
        }
    }

    const database =
        "customer_check_" + randomBytes(8).toString("hex");

    const control = new Client({
        connectionTimeoutMillis: 5000,
        statement_timeout: 15000
    });

    let created = false;
    let db;

    try {
        await control.connect();

        // Database name is generated internally.
        await control.query(`CREATE DATABASE "${database}"`);
        created = true;

        db = new Pool({
            database,
            max: 5,
            connectionTimeoutMillis: 5000,
            statement_timeout: 10000
        });

        const sql = await readFile(
            path.join(
                __dirname,
                "../migrations/001_customer_schema.sql"
            ),
            "utf8"
        );

        await db.query(sql);
        await runChecks(db);
    } finally {
        try {
            if (db) {
                await db.end();
            }
        } finally {
            try {
                if (created) {
                    await control.query(`DROP DATABASE "${database}"`);
                }
            } finally {
                await control.end();
            }
        }
    }

    console.log("CUSTOMER REPOSITORY CHECK PASSED");
}

if (require.main === module) {
    main().catch((error) => {
        console.error(
            "CUSTOMER REPOSITORY CHECK FAILED:",
            error.message
        );

        process.exitCode = 1;
    });
}

module.exports = { runChecks };