const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { client } = require("../src/infrastructure/db");

const {
    initializeProductDatabase,
    createProductRepository
} = require("../src/infrastructure/product-repository");

const {
    createProductUseCases
} = require("../src/application/product-use-cases");

const {
    ProductError
} = require("../src/domain/product-error");

const hasCode = code => error =>
    error instanceof ProductError && error.code === code;

async function main() {
    const testName =
        "p3_product_check_" + randomBytes(12).toString("hex");

    const testDb = client.db(testName);
    let owned = false;

    try {
        assert.equal(
            (await testDb.listCollections().toArray()).length,
            0
        );

        await testDb.collection("_test_owner").insertOne({
            _id: testName
        });

        owned = true;

        await initializeProductDatabase(testDb);
        await initializeProductDatabase(testDb);

        await Promise.all(
            Array.from({ length: 3 },
                () => initializeProductDatabase(testDb)
            )
        );

        const products = createProductRepository(testDb);
        const app = createProductUseCases({ products });

        const admin = { uid: 1, role: "admin" };
        const normal = { uid: 2, role: "normal" };

        const input = {
            pname: "Laptop",
            price: "1500",
            quantity: 10
        };

        assert.deepEqual(await app.listProducts(normal), []);

        const first = await app.createProduct(input, admin);

        assert.deepEqual(first, {
            pid: 1,
            pname: "Laptop",
            price: "1500.00",
            quantity: 10
        });

        assert.deepEqual(
            await app.getProduct({ pid: first.pid }, normal),
            first
        );

        const stored = await testDb.collection("products")
            .findOne({ pid: first.pid });

        assert.equal(stored.price._bsontype, "Decimal128");
        assert.ok(stored.createdAt instanceof Date);

        console.log(
            "OK: real MongoDB create/read and Decimal128 price"
        );

        const large = await app.createProduct({...input, price: "999999999999.99" },
            admin
        );

        assert.equal(
            (await products.findById(large.pid)).price,
            "999999999999.99"
        );

        const zero = await app.updateProduct({ pid: first.pid, quantity: 0 },
            admin
        );

        assert.deepEqual(zero, {...first, quantity: 0 });

        await assert.rejects(
            app.updateProduct({
                    pid: first.pid,
                    pname: "Changed",
                    price: "-1"
                },
                admin
            ),
            hasCode("VALIDATION_ERROR")
        );

        assert.deepEqual(
            await products.findById(first.pid),
            zero
        );

        await assert.rejects(
            app.updateProduct({ pid: first.pid, quantity: 99 },
                normal
            ),
            hasCode("FORBIDDEN")
        );

        console.log(
            "OK: exact price, zero quantity, rejected invalid update and forbidden role"
        );

        const concurrent = await Promise.all(
            Array.from({ length: 20 }, (_, index) =>
                app.createProduct({
                        ...input,
                        pname: "Parallel " + index
                    },
                    admin
                )
            )
        );

        assert.equal(
            new Set(concurrent.map(row => row.pid)).size,
            20
        );

        assert.equal(
            await testDb.collection("products").countDocuments({}),
            22
        );

        const { _id, ...duplicate } = stored;

        await assert.rejects(
            testDb.collection("products").insertOne(duplicate),
            error =>
            error.code === 11000 &&
            error.keyPattern &&
            error.keyPattern.pid === 1
        );

        const previousMax = Math.max(
            ...concurrent.map(row => row.pid)
        );

        await initializeProductDatabase(testDb);

        const afterInit = await app.createProduct(input, admin);

        assert.ok(afterInit.pid > previousMax);

        console.log(
            "OK: 20 concurrent creates, unique pid index and initialization without reset"
        );

        await app.deleteProduct({ pid: first.pid }, admin);

        const deleted = await testDb.collection("products")
            .findOne({ pid: first.pid });

        assert.ok(deleted.deletedAt instanceof Date);

        assert.equal(
            await products.findById(first.pid),
            null
        );

        assert.ok(!(await products.list())
            .some(row => row.pid === first.pid)
        );

        await assert.rejects(
            app.updateProduct({ pid: first.pid, quantity: 1 },
                admin
            ),
            hasCode("NOT_FOUND")
        );

        await assert.rejects(
            app.deleteProduct({ pid: first.pid }, admin),
            hasCode("NOT_FOUND")
        );

        console.log(
            "OK: soft delete hides product and prevents update/repeat delete"
        );

        await testDb.collection("counters").updateOne({ _id: "product_pid" }, { $set: { seq: 2147483647 } });

        await initializeProductDatabase(testDb);

        const countBefore = await testDb.collection("products")
            .countDocuments({});

        await assert.rejects(
            app.createProduct(input, admin),
            hasCode("ID_EXHAUSTED")
        );

        assert.equal(
            await testDb.collection("products").countDocuments({}),
            countBefore
        );

        console.log(
            "OK: exhausted int32 counter rejects new products"
        );
    } finally {
        try {
            if (owned) {
                await testDb.dropDatabase();

                console.log(
                    "CLEANUP PASSED: temporary product database removed"
                );
            }
        } finally {
            await client.close();
        }
    }

    console.log("PRODUCT DATABASE CHECK PASSED");
}

main().catch(error => {
    console.error(
        "PRODUCT DATABASE CHECK FAILED:",
        error.message
    );

    process.exitCode = 1;
});