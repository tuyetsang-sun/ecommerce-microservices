const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { client } = require("../src/infrastructure/db");

async function main() {
    const name = "p3_tx_check_" +
        randomBytes(12).toString("hex");

    const testDb = client.db(name);

    let owned = false;
    let session;

    try {
        await client.connect();

        const hello = await client.db("admin").command({
            hello: 1
        });

        assert.equal(
            hello.setName,
            process.env.MONGO_REPLICA_SET
        );

        assert.equal(hello.isWritablePrimary, true);

        console.log("OK: connected to replica set PRIMARY");

        assert.equal(
            (await testDb.listCollections().toArray()).length,
            0
        );

        await testDb.createCollection("stock_probe");
        owned = true;

        const stock = testDb.collection("stock_probe");

        await stock.insertMany([
            { _id: "A", qty: 5 },
            { _id: "B", qty: 5 }
        ]);

        session = client.startSession();

        const options = {
            readConcern: { level: "snapshot" },
            writeConcern: { w: "majority" },
            maxCommitTimeMS: 5000
        };

        // Thành công: cùng trừ A và B.
        await session.withTransaction(async() => {
            for (const id of["A", "B"]) {
                const result = await stock.updateOne({ _id: id, qty: { $gte: 2 } }, { $inc: { qty: -2 } }, { session });

                assert.equal(result.modifiedCount, 1);
            }
        }, options);

        assert.equal(
            (await stock.findOne({ _id: "A" })).qty,
            3
        );

        assert.equal(
            (await stock.findOne({ _id: "B" })).qty,
            3
        );

        console.log(
            "OK: transaction commits both stock changes"
        );

        // Thất bại: B thiếu hàng, thay đổi A phải rollback.
        await assert.rejects(
            session.withTransaction(async() => {
                await stock.updateOne({ _id: "A" }, { $inc: { qty: -1 } }, { session });

                const result = await stock.updateOne({ _id: "B", qty: { $gte: 99 } }, { $inc: { qty: -99 } }, { session });

                if (result.modifiedCount !== 1) {
                    throw new Error("EXPECTED_INSUFFICIENT_STOCK");
                }
            }, options),
            /EXPECTED_INSUFFICIENT_STOCK/
        );

        assert.equal(
            (await stock.findOne({ _id: "A" })).qty,
            3
        );

        assert.equal(
            (await stock.findOne({ _id: "B" })).qty,
            3
        );

        console.log(
            "OK: insufficient stock rolls back all changes"
        );
    } finally {
        try {
            if (session) await session.endSession();

            if (owned) {
                await testDb.dropDatabase();

                console.log(
                    "CLEANUP PASSED: temporary transaction database removed"
                );
            }
        } finally {
            await client.close();
        }
    }

    console.log("PRODUCT TRANSACTION CHECK PASSED");
}

main().catch(error => {
    console.error(
        "PRODUCT TRANSACTION CHECK FAILED:",
        error.message
    );

    process.exitCode = 1;
});