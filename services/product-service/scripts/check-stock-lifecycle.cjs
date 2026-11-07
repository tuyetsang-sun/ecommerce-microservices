const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const { client } = require("../src/infrastructure/db");

const {
    initializeProductDatabase,
    createProductRepository
} = require("../src/infrastructure/product-repository");

const {
    initializeStockDatabase,
    createStockRepository
} = require("../src/infrastructure/stock-repository");

async function main() {
    const db = client.db(
        "p3_stock_life_" + randomBytes(12).toString("hex")
    );

    let owned = false;

    try {
        await client.connect();

        assert.equal(
            (await db.listCollections().toArray()).length,
            0
        );

        await db.createCollection("test_owner");
        owned = true;

        await initializeProductDatabase(db);
        await initializeStockDatabase(db);

        const products = createProductRepository(db);
        const stock = createStockRepository({ client, db });
        const raw = db.collection("products");
        const rows = db.collection("stock_reservations");

        const a = await products.create({
            pname: "A",
            price: "100.00",
            quantity: 10
        });

        const b = await products.create({
            pname: "B",
            price: "50.00",
            quantity: 5
        });

        const request = () => ({
            reservation_id: randomUUID(),
            items: [
                { pid: a.pid, qty: 2 },
                { pid: b.pid, qty: 1 }
            ]
        });

        const action = r => ({
            reservation_id: r.reservation_id
        });

        async function balances(aQty, bQty, held) {
            assert.equal(
                (await products.findById(a.pid)).quantity,
                aQty
            );

            assert.equal(
                (await products.findById(b.pid)).quantity,
                bQty
            );

            assert.equal(
                (await raw.findOne({ pid: a.pid })).reservedQuantity,
                held
            );
        }

        // 1. Chặn sửa số lượng và xóa khi đang giữ.
        const first = request();
        await stock.reserve(first);

        await assert.rejects(
            products.update(a.pid, { quantity: 20 }), { code: "STOCK_BUSY" }
        );

        await assert.rejects(
            products.remove(a.pid), { code: "STOCK_BUSY" }
        );

        await products.update(a.pid, {
            pname: "A updated",
            price: "200.00"
        });

        await balances(8, 4, 2);

        console.log(
            "OK: held stock blocks quantity edits and deletion"
        );

        // 2. Hoàn trả đồng thời 10 lần.
        await Promise.all(
            Array.from({ length: 10 },
                () => stock.release(action(first))
            )
        );

        await balances(10, 5, 0);

        await assert.rejects(
            stock.confirm(action(first)), { code: "RESERVATION_CONFLICT" }
        );

        await assert.rejects(
            stock.reserve(first), { code: "RESERVATION_CONFLICT" }
        );

        console.log("OK: 10 releases restore stock only once");

        // 3. Hủy trước, giữ kho đến sau phải bị chặn.
        const cancelled = request();

        await stock.release(action(cancelled));
        await stock.release(action(cancelled));

        await assert.rejects(
            stock.reserve(cancelled), { code: "RESERVATION_CONFLICT" }
        );

        await assert.rejects(
            stock.confirm({ reservation_id: randomUUID() }), { code: "NOT_FOUND" }
        );

        await balances(10, 5, 0);

        console.log("OK: cancellation blocks late reservation");

        // 4. Xác nhận không cộng lại hàng.
        const confirmed = request();
        const saved = await stock.reserve(confirmed);

        await Promise.all(
            Array.from({ length: 10 },
                () => stock.confirm(action(confirmed))
            )
        );

        await balances(8, 4, 0);

        assert.deepEqual(
            await stock.reserve(confirmed),
            saved
        );

        await assert.rejects(
            stock.release(action(confirmed)), { code: "RESERVATION_CONFLICT" }
        );

        await products.update(a.pid, { quantity: 10 });
        await products.update(b.pid, { quantity: 5 });

        console.log(
            "OK: confirmation is idempotent and unlocks stock editing"
        );

        // 5. Giả lập dữ liệu lỗi, chỉ trong database kiểm thử.
        const broken = request();
        await stock.reserve(broken);

        await raw.updateOne({ pid: b.pid }, { $set: { reservedQuantity: 0 } });

        await assert.rejects(
            stock.release(action(broken)), { code: "STOCK_INCONSISTENT" }
        );

        await balances(8, 4, 2);

        assert.equal(
            (await rows.findOne({
                _id: broken.reservation_id
            })).state,
            "RESERVED"
        );

        await raw.updateOne({ pid: b.pid }, { $set: { reservedQuantity: 1 } });

        await stock.release(action(broken));
        await balances(10, 5, 0);

        console.log(
            "OK: failed release rolls back all product changes"
        );

        // 6. Hoàn trả và xác nhận chạy đồng thời.
        const competing = request();
        await stock.reserve(competing);

        const outcomes = await Promise.allSettled([
            stock.release(action(competing)),
            stock.confirm(action(competing))
        ]);

        assert.equal(
            outcomes.filter(
                r => r.status === "fulfilled"
            ).length,
            1
        );

        const failure = outcomes.find(
            r => r.status === "rejected"
        );

        assert.equal(
            failure.reason.code,
            "RESERVATION_CONFLICT"
        );

        const final = await rows.findOne({
            _id: competing.reservation_id
        });

        assert.ok(
            ["RELEASED", "CONFIRMED"].includes(final.state)
        );

        await balances(
            final.state === "RELEASED" ? 10 : 8,
            final.state === "RELEASED" ? 5 : 4,
            0
        );

        assert.equal(
            (await raw.findOne({ pid: b.pid })).reservedQuantity,
            0
        );

        assert.equal(await products.remove(a.pid), true);

        console.log(
            "OK: release versus confirm has only one final outcome"
        );
    } finally {
        try {
            if (owned) {
                await db.dropDatabase();

                console.log(
                    "CLEANUP PASSED: temporary lifecycle database removed"
                );
            }
        } finally {
            await client.close();
        }
    }

    console.log("STOCK LIFECYCLE CHECK PASSED");
}

main().catch(error => {
    console.error(
        "STOCK LIFECYCLE CHECK FAILED:",
        error.code || error.name,
        error.message
    );

    process.exitCode = 1;
});