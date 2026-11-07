const rules = require("../domain/product-rules");
const {
    normalizeReserveStock
} = require("../domain/stock-rules");

async function initializeStockDatabase(db) {
    await db.collection("stock_reservations").createIndex({ state: 1, createdAt: 1 }, { name: "stock_reservations_state_created" });
}

function createStockRepository({ client, db }) {
    const products = db.collection("products");
    const reservations = db.collection("stock_reservations");

    function response(row) {
        return {
            reservation_id: row._id,
            items: row.items.map(item => ({
                pid: item.pid,
                qty: item.qty,
                unit_price: item.unit_price
            }))
        };
    }

    async function reserve(input) {
        const request = normalizeReserveStock(input);
        const session = client.startSession();

        try {
            for (let attempt = 0; attempt < 3; attempt += 1) {
                try {
                    return await session.withTransaction(async() => {
                        const previous = await reservations.findOne({ _id: request.reservation_id }, { session });

                        if (previous) {
                            if (
                                previous.request_hash !==
                                request.request_hash
                            ) {
                                rules.fail(
                                    "RESERVATION_CONFLICT",
                                    "Reservation items have changed"
                                );
                            }

                            if (previous.state !== "RESERVED") {
                                rules.fail(
                                    "RESERVATION_CONFLICT",
                                    "Reservation is no longer active"
                                );
                            }

                            return response(previous);
                        }

                        const row = {
                            _id: request.reservation_id,
                            request_hash: request.request_hash,
                            state: "RESERVED",
                            items: [],
                            createdAt: new Date(),
                            updatedAt: new Date()
                        };

                        await reservations.insertOne(row, { session });

                        for (const item of request.items) {
                            const product = await products.findOneAndUpdate({
                                pid: item.pid,
                                deletedAt: null,
                                quantity: { $gte: item.qty },
                                $expr: {
                                    $lte: [{
                                            $ifNull: [
                                                "$reservedQuantity",
                                                0
                                            ]
                                        },
                                        2147483647 - item.qty
                                    ]
                                }
                            }, {
                                $inc: {
                                    quantity: -item.qty,
                                    reservedQuantity: item.qty
                                },
                                $set: {
                                    updatedAt: new Date()
                                }
                            }, {
                                session,
                                returnDocument: "before",
                                includeResultMetadata: false
                            });

                            if (!product) {
                                const exists = await products.findOne({
                                    pid: item.pid,
                                    deletedAt: null
                                }, {
                                    session,
                                    projection: { _id: 1 }
                                });

                                if (!exists) {
                                    rules.fail(
                                        "NOT_FOUND",
                                        "Product not found: " + item.pid
                                    );
                                }

                                rules.fail(
                                    "INSUFFICIENT_STOCK",
                                    "Stock unavailable for product: " +
                                    item.pid
                                );
                            }

                            row.items.push({
                                pid: item.pid,
                                qty: item.qty,
                                unit_price: rules.price(
                                    product.price.toString()
                                )
                            });
                        }

                        await reservations.updateOne({ _id: row._id }, {
                            $set: {
                                items: row.items
                            }
                        }, { session });

                        return response(row);
                    }, {
                        readConcern: { level: "snapshot" },
                        writeConcern: { w: "majority" },
                        readPreference: "primary",
                        timeoutMS: 10000,
                        maxCommitTimeMS: 5000
                    });
                } catch (error) {
                    // Hai request có thể cùng tạo một reservation_id.
                    if (error.code !== 11000 || attempt === 2) {
                        throw error;
                    }
                }
            }
        } finally {
            await session.endSession();
        }
    }

    return { reserve };
}

module.exports = {
    initializeStockDatabase,
    createStockRepository
};