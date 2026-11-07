const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const { Decimal128 } = require("mongodb");
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
        "p3_stock_check_" + randomBytes(12).toString("hex")
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
        const reservations = db.collection("stock_reservations");

        const create = quantity => products.create({
            pname: "Stock test",
            price: "100.00",
            quantity
        });

        const a = await create(10);
        const b = await create(5);

        const request = {
            reservation_id: randomUUID(),
            items: [
                { pid: a.pid, qty: 2 },
                { pid: b.pid, qty: 1 }
            ]
        };

        // 1. Giữ kho thành công và lưu giá.
        const first = await stock.reserve(request);

        assert.equal(
            (await products.findById(a.pid)).quantity,
            8
        );

        assert.equal(
            (await products.findById(b.pid)).quantity,
            4
        );

        assert.equal(
            (await raw.findOne({ pid: a.pid })).reservedQuantity,
            2
        );

        assert.equal(first.items[0].unit_price, "100.00");

        console.log("OK: reserves all items and snapshots prices");

        // 2. Đổi giá rồi gửi lại: vẫn trả giá cũ, không trừ thêm.
        await raw.updateOne({ pid: a.pid }, {
            $set: {
                price: Decimal128.fromString("200.00")
            }
        });

        assert.deepEqual(
            await stock.reserve({
                ...request,
                items: [...request.items].reverse()
            }),
            first
        );

        assert.equal(
            (await products.findById(a.pid)).quantity,
            8
        );

        console.log(
            "OK: retry keeps original price and does not deduct again"
        );

        // 3. Cùng mã nhưng thay nội dung phải bị từ chối.
        await assert.rejects(
            stock.reserve({
                ...request,
                items: [{ pid: a.pid, qty: 3 }]
            }), { code: "RESERVATION_CONFLICT" }
        );

        assert.equal(
            (await products.findById(a.pid)).quantity,
            8
        );

        console.log("OK: same ID with different items is rejected");

        // 4. Sản phẩm sau thiếu hoặc không tồn tại:
        // sản phẩm trước phải được hoàn tác.
        for (const [pid, qty, code] of[
                [b.pid, 99, "INSUFFICIENT_STOCK"], [2147483647, 1, "NOT_FOUND"]
            ]) {
            const id = randomUUID();

            await assert.rejects(
                stock.reserve({
                    reservation_id: id,
                    items: [
                        { pid: a.pid, qty: 1 },
                        { pid, qty }
                    ]
                }), { code }
            );

            assert.equal(
                (await products.findById(a.pid)).quantity,
                8
            );

            assert.equal(
                (await raw.findOne({ pid: a.pid })).reservedQuantity,
                2
            );

            assert.equal(
                await reservations.findOne({ _id: id }),
                null
            );
        }

        console.log(
            "OK: missing or insufficient product rolls back everything"
        );

        // 5. Gửi đồng thời 10 lần cùng một yêu cầu.
        const c = await create(5);

        const same = {
            reservation_id: randomUUID(),
            items: [{ pid: c.pid, qty: 1 }]
        };

        const repeated = await Promise.all(
            Array.from({ length: 10 },
                () => stock.reserve(same)
            )
        );

        for (const result of repeated) {
            assert.deepEqual(result, repeated[0]);
        }

        assert.equal(
            (await products.findById(c.pid)).quantity,
            4
        );

        assert.equal(
            await reservations.countDocuments({
                _id: same.reservation_id
            }),
            1
        );

        console.log(
            "OK: 10 concurrent identical requests deduct only once"
        );

        // 6. Có 5 sản phẩm, 10 yêu cầu khác nhau cùng mua.
        const d = await create(5);

        const results = await Promise.allSettled(
            Array.from({ length: 10 },
                () => stock.reserve({
                    reservation_id: randomUUID(),
                    items: [{ pid: d.pid, qty: 1 }]
                })
            )
        );

        assert.equal(
            results.filter(r => r.status === "fulfilled").length,
            5
        );

        for (const result of results.filter(
                r => r.status === "rejected"
            )) {
            assert.equal(
                result.reason.code,
                "INSUFFICIENT_STOCK"
            );
        }

        assert.equal(
            (await products.findById(d.pid)).quantity,
            0
        );

        assert.equal(
            (await raw.findOne({ pid: d.pid })).reservedQuantity,
            5
        );

        console.log(
            "OK: 10 competing requests cannot oversell stock of 5"
        );
    } finally {
        try {
            if (owned) {
                await db.dropDatabase();

                console.log(
                    "CLEANUP PASSED: temporary stock database removed"
                );
            }
        } finally {
            await client.close();
        }
    }

    console.log("STOCK RESERVE CHECK PASSED");
}

main().catch(error => {
    console.error(
        "STOCK RESERVE CHECK FAILED:",
        error.code || error.name,
        error.message
    );

    process.exitCode = 1;
});