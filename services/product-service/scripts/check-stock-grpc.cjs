const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const { client } = require("../src/infrastructure/db");
const { grpc, ecommerce } = require("../src/infrastructure/proto");

const {
    createStockHandlers
} = require("../src/interfaces/grpc/stock-handlers");

const {
    initializeProductDatabase,
    createProductRepository
} = require("../src/infrastructure/product-repository");

const {
    initializeStockDatabase,
    createStockRepository
} = require("../src/infrastructure/stock-repository");

const token = process.env.STOCK_SERVICE_TOKEN;

function headers(value = token) {
    const metadata = new grpc.Metadata();

    if (value) {
        metadata.set("x-stock-service-token", value);
    }

    return metadata;
}

function rpc(target, method, input, metadata = headers()) {
    return new Promise((resolve, reject) => {
        target[method](
            input,
            metadata, { deadline: Date.now() + 30000 },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );
    });
}

async function main() {
    assert.match(token || "", /^[0-9a-f]{64}$/i);

    const live = new ecommerce.product.ProductService(
        "127.0.0.1:" + (process.env.GRPC_PORT || 50053),
        grpc.credentials.createInsecure()
    );

    const db = client.db(
        "p3_stock_grpc_" + randomBytes(12).toString("hex")
    );

    let owned = false;
    let server;
    let testClient;

    try {
        // 1. Kiểm tra bảo vệ RPC trên service đang chạy.
        const wrong =
            (token[0] === "0" ? "1" : "0") + token.slice(1);

        const duplicate = headers();
        duplicate.add("x-stock-service-token", token);

        const bearerOnly = new grpc.Metadata();
        bearerOnly.set("authorization", "Bearer example.user.jwt");

        for (const method of[
                "reserveStock",
                "releaseStock",
                "confirmStock"
            ]) {
            for (const metadata of[
                    headers(null),
                    headers(wrong),
                    duplicate,
                    bearerOnly
                ]) {
                await assert.rejects(
                    rpc(
                        live,
                        method, { reservation_id: "invalid" },
                        metadata
                    ), { code: grpc.status.UNAUTHENTICATED }
                );
            }

            await assert.rejects(
                rpc(live, method, { reservation_id: "invalid" }), { code: grpc.status.INVALID_ARGUMENT }
            );
        }

        await assert.rejects(
            rpc(live, "confirmStock", {
                reservation_id: randomUUID()
            }), { code: grpc.status.NOT_FOUND }
        );

        console.log("OK: live service protects all 3 stock RPCs");

        // 2. Tạo database và gRPC server kiểm thử riêng.
        await client.connect();

        assert.equal(
            (await db.listCollections().toArray()).length,
            0
        );

        await db.createCollection("test_owner");
        owned = true;

        await initializeProductDatabase(db);
        await initializeStockDatabase(db);

        server = new grpc.Server();

        server.addService(
            ecommerce.product.ProductService.service,
            createStockHandlers({
                stock: createStockRepository({ client, db }),
                serviceToken: token
            })
        );

        const port = await new Promise((resolve, reject) => {
            server.bindAsync(
                "127.0.0.1:0",
                grpc.ServerCredentials.createInsecure(),
                (error, value) => {
                    if (error) return reject(error);
                    resolve(value);
                }
            );
        });

        testClient = new ecommerce.product.ProductService(
            "127.0.0.1:" + port,
            grpc.credentials.createInsecure()
        );

        const products = createProductRepository(db);

        const p = await products.create({
            pname: "RPC stock test",
            price: "100.00",
            quantity: 5
        });

        // 3. Giữ kho và gửi lại cùng yêu cầu.
        const request = {
            reservation_id: randomUUID(),
            items: [{ pid: p.pid, qty: 2 }]
        };

        const first = await rpc(
            testClient,
            "reserveStock",
            request
        );

        assert.equal(first.items[0].unit_price, "100.00");

        assert.deepEqual(
            await rpc(testClient, "reserveStock", request),
            first
        );

        assert.equal(
            (await products.findById(p.pid)).quantity,
            3
        );

        console.log("OK: gRPC reserve and retry deduct only once");

        // 4. Đổi nội dung hoặc mua vượt tồn kho.
        for (const input of[{
                ...request,
                items: [{ pid: p.pid, qty: 3 }]
            }, {
                reservation_id: randomUUID(),
                items: [{ pid: p.pid, qty: 99 }]
            }]) {
            await assert.rejects(
                rpc(testClient, "reserveStock", input), { code: grpc.status.FAILED_PRECONDITION }
            );
        }

        assert.equal(
            (await products.findById(p.pid)).quantity,
            3
        );

        console.log(
            "OK: conflict and insufficient stock return gRPC code 9"
        );

        // 5. Hoàn trả hai lần, chỉ cộng hàng một lần.
        const action = {
            reservation_id: request.reservation_id
        };

        for (let i = 0; i < 2; i += 1) {
            const released = await rpc(
                testClient,
                "releaseStock",
                action
            );

            assert.equal(
                released.message,
                "Stock released successfully"
            );
        }

        assert.equal(
            (await products.findById(p.pid)).quantity,
            5
        );

        await assert.rejects(
            rpc(testClient, "confirmStock", action), { code: 9 }
        );

        console.log("OK: gRPC release restores stock only once");

        // 6. Giữ kho mới và xác nhận hai lần.
        const next = {
            ...request,
            reservation_id: randomUUID()
        };

        const saved = await rpc(
            testClient,
            "reserveStock",
            next
        );

        const nextAction = {
            reservation_id: next.reservation_id
        };

        for (let i = 0; i < 2; i += 1) {
            const confirmed = await rpc(
                testClient,
                "confirmStock",
                nextAction
            );

            assert.equal(
                confirmed.message,
                "Stock confirmed successfully"
            );
        }

        assert.equal(
            (await products.findById(p.pid)).quantity,
            3
        );

        assert.equal(
            (await db.collection("products").findOne({
                pid: p.pid
            })).reservedQuantity,
            0
        );

        assert.deepEqual(
            await rpc(testClient, "reserveStock", next),
            saved
        );

        await assert.rejects(
            rpc(testClient, "releaseStock", nextAction), { code: 9 }
        );

        console.log(
            "OK: gRPC confirmation is final and idempotent"
        );
    } finally {
        live.close();

        if (testClient) testClient.close();
        if (server) server.forceShutdown();

        try {
            if (owned) {
                await db.dropDatabase();

                console.log(
                    "CLEANUP PASSED: temporary gRPC database removed"
                );
            }
        } finally {
            await client.close();
        }
    }

    console.log("STOCK GRPC CHECK PASSED");
}

main().catch(error => {
    console.error(
        "STOCK GRPC CHECK FAILED:",
        error.code || error.name
    );

    process.exitCode = 1;
});