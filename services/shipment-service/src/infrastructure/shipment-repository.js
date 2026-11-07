const { createHash } = require("node:crypto");
const { InvalidOrderEvent } = require("../domain/order-event");

async function initializeShipmentDatabase(db) {
    const rows = db.collection("shipments");

    await rows.createIndex({ oid: 1 }, { unique: true });
    await rows.createIndex({ shipid: 1 }, { unique: true });
    await rows.createIndex({ event_id: 1 }, { unique: true });

    const latest = await rows.find({})
        .sort({ shipid: -1 })
        .limit(1)
        .next();

    await db.collection("counters").updateOne({ _id: "shipment_id" }, { $max: { seq: latest ? latest.shipid : 0 } }, { upsert: true });
}

function createShipmentRepository(db) {
    const rows = db.collection("shipments");

    async function createFromOrder(event) {
        const hash = createHash("sha256")
            .update(JSON.stringify(event))
            .digest("hex");

        function existing(row) {
            if (!row || row.event_hash !== hash) {
                throw new InvalidOrderEvent(
                    "Order or event already belongs to another shipment payload"
                );
            }

            return {
                shipment: row,
                created: false
            };
        }

        const previous = await rows.findOne({
            oid: event.oid
        });

        if (previous) return existing(previous);

        const counter = await db.collection("counters")
            .findOneAndUpdate({
                _id: "shipment_id",
                seq: { $gte: 0, $lt: 2147483647 }
            }, {
                $inc: { seq: 1 }
            }, {
                returnDocument: "after",
                includeResultMetadata: false
            });

        if (!counter) {
            throw new Error(
                "Shipment ID counter unavailable or exhausted"
            );
        }

        const row = {
            ...event,
            shipid: counter.seq,
            status: "pending",
            event_hash: hash,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        try {
            await rows.insertOne(row, {
                writeConcern: { w: 1, j: true }
            });
        } catch (error) {
            if (error.code !== 11000) throw error;

            const found = await rows.findOne({
                $or: [
                    { oid: event.oid },
                    { event_id: event.event_id }
                ]
            });

            if (!found) throw error;

            return existing(found);
        }

        return {
            shipment: row,
            created: true
        };
    }

    return { createFromOrder };
}

module.exports = {
    initializeShipmentDatabase,
    createShipmentRepository
};