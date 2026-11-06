const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomBytes } = require("node:crypto");
const { grpc, ecommerce } = require("../src/infrastructure/proto");

const auth = new ecommerce.auth.AuthService(
    process.env.AUTH_GRPC_ADDRESS || "auth-service:50051",
    grpc.credentials.createInsecure()
);

const product = new ecommerce.product.ProductService(
    "127.0.0.1:" + (process.env.GRPC_PORT || 50053),
    grpc.credentials.createInsecure()
);

function rpc(client, method, input, token, extra = {}) {
    const metadata = new grpc.Metadata();

    if (token) {
        metadata.set("authorization", "Bearer " + token);
    }

    for (const [key, value] of Object.entries(extra)) {
        metadata.set(key, value);
    }

    return new Promise((resolve, reject) => {
        client[method](
            input,
            metadata, { deadline: Date.now() + 10000 },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );
    });
}

const hasCode = code => error => error.code === code;

async function main() {
    let adminToken;
    let createdPid;

    try {
        const credentials = JSON.parse(
            fs.readFileSync(0, "utf8").replace(/^\uFEFF/, "")
        );

        assert.equal(typeof credentials.username, "string");
        assert.equal(typeof credentials.password, "string");

        const login = await rpc(auth, "login", credentials);
        adminToken = login.access_token;

        const admin = await rpc(auth, "verifyToken", {
            access_token: adminToken
        });

        assert.equal(
            admin.role,
            "admin",
            "Account must have admin role"
        );

        const suffix = randomBytes(6).toString("hex");

        const account = {
            username: "p3grpc_" + suffix,
            password: "Aa1!" + randomBytes(12).toString("hex")
        };

        await rpc(auth, "register", account);

        const normalLogin = await rpc(auth, "login", account);
        const token = normalLogin.access_token;

        const normal = await rpc(auth, "verifyToken", {
            access_token: token
        });

        assert.equal(normal.role, "normal");

        const input = {
            pname: "gRPC test " + suffix,
            price: "1500",
            quantity: 10
        };

        // Cả 5 thao tác đều phải yêu cầu token.
        for (const [method, body] of[
                ["listProducts", {}], ["getProduct", { pid: 1 }], ["createProduct", input], ["updateProduct", { pid: 1, quantity: 1 }], ["deleteProduct", { pid: 1 }]
            ]) {
            await assert.rejects(
                rpc(product, method, body),
                hasCode(16)
            );
        }

        await assert.rejects(
            rpc(product, "listProducts", {}, "invalid.test.token"),
            hasCode(16)
        );

        await assert.rejects(
            rpc(product, "createProduct", input, token, {
                "x-user-role": "admin"
            }),
            hasCode(7)
        );

        console.log(
            "OK: missing/invalid JWT rejected; forged role rejected"
        );

        // Admin tạo; normal đọc.
        const created = await rpc(
            product, "createProduct", input, adminToken
        );

        createdPid = created.pid;

        assert.ok(
            Number.isInteger(createdPid) && createdPid > 0
        );

        assert.deepEqual(created, {
            ...input,
            pid: createdPid,
            price: "1500.00"
        });

        const id = { pid: createdPid };

        assert.deepEqual(
            await rpc(product, "getProduct", id, token),
            created
        );

        const list = await rpc(
            product, "listProducts", {}, token
        );

        assert.ok(
            list.items.some(item => item.pid === createdPid)
        );

        console.log(
            "OK: admin creates; normal reads and lists products"
        );

        // Normal không được sửa/xóa.
        await assert.rejects(
            rpc(product, "updateProduct", {
                ...id,
                quantity: 1
            }, token),
            hasCode(7)
        );

        await assert.rejects(
            rpc(product, "deleteProduct", id, token),
            hasCode(7)
        );

        // quantity = 0 phải được cập nhật đúng.
        const updated = await rpc(
            product, "updateProduct", {
                ...id,
                quantity: 0
            }, adminToken
        );

        assert.deepEqual(updated, {
            ...created,
            quantity: 0
        });

        await assert.rejects(
            rpc(product, "updateProduct", {
                ...id,
                price: "-1"
            }, adminToken),
            hasCode(3)
        );

        await assert.rejects(
            rpc(product, "updateProduct", id, adminToken),
            hasCode(3)
        );

        assert.deepEqual(
            await rpc(product, "getProduct", id, token),
            updated
        );

        console.log(
            "OK: writes protected; quantity zero and validation passed"
        );

        // Xóa sản phẩm do script vừa tạo.
        const deleted = await rpc(
            product, "deleteProduct", id, adminToken
        );

        createdPid = undefined;

        assert.equal(
            deleted.message,
            "Product deleted successfully"
        );

        await assert.rejects(
            rpc(product, "getProduct", id, token),
            hasCode(5)
        );

        await assert.rejects(
            rpc(product, "deleteProduct", id, adminToken),
            hasCode(5)
        );

        console.log(
            "OK: admin deletes; deleted product returns NOT_FOUND"
        );
    } finally {
        try {
            if (createdPid && adminToken) {
                await rpc(product, "deleteProduct", {
                    pid: createdPid
                }, adminToken);
            }
        } finally {
            auth.close();
            product.close();
        }
    }

    console.log("PRODUCT GRPC CHECK PASSED");
}

main().catch(error => {
    console.error(
        "PRODUCT GRPC CHECK FAILED:",
        error.message
    );
    process.exitCode = 1;
});