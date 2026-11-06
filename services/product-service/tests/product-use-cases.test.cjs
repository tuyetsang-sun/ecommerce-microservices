const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createProductUseCases
} = require("../src/application/product-use-cases");

const {
    ProductError
} = require("../src/domain/product-error");

const {
    price
} = require("../src/domain/product-rules");

const admin = { uid: 1, role: "admin" };
const normal = { uid: 2, role: "normal" };

const valid = {
    pname: "Laptop",
    price: "1500",
    quantity: 10
};

const hasCode = code => error =>
    error instanceof ProductError && error.code === code;

function fixture() {
    let nextId = 1;
    const rows = new Map();
    const calls = [];
    const copy = value => structuredClone(value);

    const products = {
        async list() {
            calls.push("list");
            return [...rows.values()].map(copy);
        },

        async findById(pid) {
            calls.push("find");
            return copy(rows.get(pid) || null);
        },

        async create(data) {
            calls.push("create");

            const row = { pid: nextId++, ...data };
            rows.set(row.pid, row);

            return copy(row);
        },

        async update(pid, patch) {
            calls.push("update");

            if (!rows.has(pid)) return null;

            const row = {...rows.get(pid), ...patch };
            rows.set(pid, row);

            return copy(row);
        },

        async remove(pid) {
            calls.push("remove");
            return rows.delete(pid);
        }
    };

    return {
        app: createProductUseCases({ products }),
        calls,
        products
    };
}

test("admin creates normalized product; client cannot assign pid", async() => {
    const { app } = fixture();

    const row = await app.createProduct({...valid, pname: " Laptop ", pid: 999 },
        admin
    );

    assert.deepEqual(row, {
        pid: 1,
        pname: "Laptop",
        price: "1500.00",
        quantity: 10
    });
});

test("normal and admin can list and read products", async() => {
    const { app } = fixture();
    const row = await app.createProduct(valid, admin);

    for (const actor of[normal, admin]) {
        assert.deepEqual(await app.listProducts(actor), [row]);

        assert.deepEqual(
            await app.getProduct({ pid: row.pid }, actor),
            row
        );
    }
});

test("normal cannot create, update or delete, even with forged body role", async() => {
    const { app, calls } = fixture();

    for (const operation of[
            "createProduct",
            "updateProduct",
            "deleteProduct"
        ]) {
        await assert.rejects(
            app[operation]({...valid, pid: 1, role: "admin" },
                normal
            ),
            hasCode("FORBIDDEN")
        );
    }

    assert.deepEqual(calls, []);
});

test("all operations reject missing verified identity", async() => {
    const { app, calls } = fixture();

    await assert.rejects(
        app.listProducts(null),
        hasCode("UNAUTHENTICATED")
    );

    for (const operation of[
            "getProduct",
            "createProduct",
            "updateProduct",
            "deleteProduct"
        ]) {
        await assert.rejects(
            app[operation]({...valid, pid: 1 }, null),
            hasCode("UNAUTHENTICATED")
        );
    }

    assert.deepEqual(calls, []);
});

test("invalid pid is rejected before repository access", async() => {
    const { app, calls } = fixture();

    for (const pid of[0, -1, 1.5, "1", null, 2147483648]) {
        for (const operation of[
                "getProduct",
                "updateProduct",
                "deleteProduct"
            ]) {
            await assert.rejects(
                app[operation]({ pid, quantity: 1 }, admin),
                hasCode("VALIDATION_ERROR")
            );
        }
    }

    assert.deepEqual(calls, []);
});

test("invalid prices are rejected without writes", async() => {
    const { app, calls } = fixture();

    for (const value of[
            0, 1500, "0", "0.00", "-1", "1.234",
            "1e3", "1,000", "01", "1000000000000", "NaN", null
        ]) {
        await assert.rejects(
            app.createProduct({...valid, price: value }, admin),
            hasCode("VALIDATION_ERROR")
        );
    }

    assert.deepEqual(calls, []);
});

test("decimal normalization preserves exact small and large prices", () => {
    assert.equal(price("0.01"), "0.01");
    assert.equal(price("12.3"), "12.30");
    assert.equal(price(" 100000 "), "100000.00");
    assert.equal(price("999999999999.99"), "999999999999.99");
});

test("empty, long and invalid names are rejected", async() => {
    const { app, calls } = fixture();

    for (const pname of[
            "", "  ", "x".repeat(121), "a\u0000b", 123, null
        ]) {
        await assert.rejects(
            app.createProduct({...valid, pname }, admin),
            hasCode("VALIDATION_ERROR")
        );
    }

    assert.deepEqual(calls, []);
});

test("quantity must be a nonnegative int32", async() => {
    const { app, calls } = fixture();

    for (const quantity of[-1, 1.5, "10", null, 2147483648]) {
        await assert.rejects(
            app.createProduct({...valid, quantity }, admin),
            hasCode("VALIDATION_ERROR")
        );
    }

    assert.deepEqual(calls, []);
});

test("updating quantity to zero preserves name and price", async() => {
    const { app } = fixture();
    const row = await app.createProduct(valid, admin);

    const updated = await app.updateProduct({ pid: row.pid, quantity: 0 },
        admin
    );

    assert.deepEqual(updated, {...row, quantity: 0 });
});

test("empty patch is rejected", async() => {
    const { app, calls } = fixture();

    await assert.rejects(
        app.updateProduct({ pid: 1 }, admin),
        hasCode("VALIDATION_ERROR")
    );

    assert.deepEqual(calls, []);
});

test("invalid patch cannot partially change product", async() => {
    const { app } = fixture();
    const row = await app.createProduct(valid, admin);

    await assert.rejects(
        app.updateProduct({ pid: row.pid, pname: "Changed", price: "-1" },
            admin
        ),
        hasCode("VALIDATION_ERROR")
    );

    assert.deepEqual(
        await app.getProduct({ pid: row.pid }, normal),
        row
    );
});

test("missing product returns NOT_FOUND for read, update and delete", async() => {
    const { app } = fixture();

    for (const operation of[
            "getProduct",
            "updateProduct",
            "deleteProduct"
        ]) {
        await assert.rejects(
            app[operation]({ pid: 999, quantity: 0 }, admin),
            hasCode("NOT_FOUND")
        );
    }
});

test("admin deletes product; later read and repeat delete return NOT_FOUND", async() => {
    const { app } = fixture();
    const row = await app.createProduct(valid, admin);

    assert.deepEqual(
        await app.deleteProduct({ pid: row.pid }, admin), {
            message: "Product deleted successfully",
            pid: row.pid
        }
    );

    await assert.rejects(
        app.getProduct({ pid: row.pid }, normal),
        hasCode("NOT_FOUND")
    );

    await assert.rejects(
        app.deleteProduct({ pid: row.pid }, admin),
        hasCode("NOT_FOUND")
    );
});

test("repository failure is propagated instead of returning success", async() => {
    const { app, products } = fixture();
    const failure = new Error("Database unavailable");

    products.create = async() => {
        throw failure;
    };

    await assert.rejects(
        app.createProduct(valid, admin),
        error => error === failure
    );
});

test("empty catalog returns an empty array", async() => {
    const { app } = fixture();

    assert.deepEqual(await app.listProducts(normal), []);
});