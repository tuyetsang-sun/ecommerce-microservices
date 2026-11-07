const { Decimal128 } = require("mongodb");
const rules = require("../domain/product-rules");

async function initializeProductDatabase(db) {
    const products = db.collection("products");
    const counters = db.collection("counters");

    await products.createIndex({ pid: 1 }, {
        unique: true,
        name: "products_pid_unique"
    });

    const latest = await products.find({})
        .sort({ pid: -1 })
        .limit(1)
        .next();

    const minimum = latest ?
        rules.integer(latest.pid, 1, "pid") :
        0;

    const filter = { _id: "product_pid" };
    const update = { $max: { seq: minimum } };

    try {
        await counters.updateOne(
            filter,
            update, { upsert: true }
        );
    } catch (error) {
        if (error.code !== 11000) throw error;

        await counters.updateOne(filter, update);
    }

    const counter = await counters.findOne(filter);

    if (!counter) {
        throw new Error("Product counter initialization failed");
    }

    rules.integer(counter.seq, 0, "counter.seq");
}

function createProductRepository(db) {
    const products = db.collection("products");
    const counters = db.collection("counters");

    function dto(row) {
        if (!row) return null;

        return {
            pid: row.pid,
            pname: row.pname,
            price: row.price.toString(),
            quantity: row.quantity
        };
    }

    function storedInput(input, creating) {
        const data = rules.productInput(input, creating);

        if (Object.hasOwn(data, "price")) {
            data.price = Decimal128.fromString(data.price);
        }

        return data;
    }

    async function list() {
        const rows = await products.find({ deletedAt: null })
            .sort({ pid: 1 })
            .toArray();

        return rows.map(dto);
    }

    async function findById(pid) {
        rules.integer(pid, 1, "pid");

        return dto(
            await products.findOne({ pid, deletedAt: null })
        );
    }

    async function create(input) {
        const data = storedInput(input, true);

        const counter = await counters.findOneAndUpdate({
            _id: "product_pid",
            seq: {
                $gte: 0,
                $lt: 2147483647,
                $type: ["int", "long"]
            }
        }, { $inc: { seq: 1 } }, {
            returnDocument: "after",
            includeResultMetadata: false
        });

        if (!counter) {
            rules.fail(
                "ID_EXHAUSTED",
                "Product ID counter unavailable or exhausted"
            );
        }

        const now = new Date();

        const row = {
            pid: rules.integer(counter.seq, 1, "pid"),
            ...data,
            reservedQuantity: 0,
            createdAt: now,
            updatedAt: now,
            deletedAt: null
        };

        await products.insertOne(row);

        return dto(row);
    }

    function stockUnlocked(pid) {
        return {
            pid,
            deletedAt: null,
            $expr: {
                $eq: [
                    { $ifNull: ["$reservedQuantity", 0] },
                    0
                ]
            }
        };
    }

    async function rejectLockedProduct(pid) {
        const exists = await products.findOne({
            pid,
            deletedAt: null
        });

        if (exists) {
            rules.fail(
                "STOCK_BUSY",
                "Product stock is currently reserved"
            );
        }
    }

    async function update(pid, input) {
        rules.integer(pid, 1, "pid");

        const patch = storedInput(input, false);
        const changesQuantity = Object.hasOwn(patch, "quantity");

        const filter = changesQuantity ?
            stockUnlocked(pid) :
            { pid, deletedAt: null };

        const row = await products.findOneAndUpdate(
            filter, {
                $set: {
                    ...patch,
                    updatedAt: new Date()
                }
            }, {
                returnDocument: "after",
                includeResultMetadata: false
            }
        );

        if (!row && changesQuantity) {
            await rejectLockedProduct(pid);
        }

        return dto(row);
    }

    async function remove(pid) {
        rules.integer(pid, 1, "pid");

        const now = new Date();

        const result = await products.updateOne(
            stockUnlocked(pid), {
                $set: {
                    deletedAt: now,
                    updatedAt: now
                }
            }
        );

        if (result.modifiedCount !== 1) {
            await rejectLockedProduct(pid);
        }

        return result.modifiedCount === 1;
    }

    return {
        list,
        findById,
        create,
        update,
        remove
    };
}

module.exports = {
    initializeProductDatabase,
    createProductRepository
};