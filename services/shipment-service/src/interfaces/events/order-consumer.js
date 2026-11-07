const { Kafka, logLevel } = require("kafkajs");

const {
    InvalidOrderEvent
} = require("../../domain/order-event");

function createOrderConsumer({ db, receiveOrder, onFatal }) {
    const kafka = new Kafka({
        clientId: "shipment-service",
        brokers: (process.env.KAFKA_BROKERS || "kafka:9092").split(","),
        connectionTimeout: 3000,
        requestTimeout: 10000,
        retry: { retries: 5 },
        logLevel: logLevel.ERROR
    });

    const consumer = kafka.consumer({
        groupId: process.env.KAFKA_GROUP_ID || "shipment-service-v1",
        allowAutoTopicCreation: false
    });

    let ready = false;

    consumer.on(consumer.events.GROUP_JOIN, () => {
        ready = true;
    });

    consumer.on(consumer.events.DISCONNECT, () => {
        ready = false;
    });

    consumer.on(consumer.events.STOP, () => {
        ready = false;
    });

    consumer.on(consumer.events.CRASH, () => {
        ready = false;
        onFatal();
    });

    return {
        isReady: () => ready,

        async start() {
            const admin = kafka.admin();

            try {
                await admin.connect();

                await admin.createTopics({
                    waitForLeaders: true,
                    topics: [{
                        topic: "order-created",
                        numPartitions: 1,
                        replicationFactor: 1
                    }]
                });
            } finally {
                await admin.disconnect();
            }

            await consumer.connect();

            await consumer.subscribe({
                topic: "order-created",
                fromBeginning: true
            });

            await consumer.run({
                autoCommit: false,

                eachMessage: async({
                    topic,
                    partition,
                    message,
                    heartbeat
                }) => {
                    try {
                        if (!message.value ||
                            message.value.length > 262144
                        ) {
                            throw new InvalidOrderEvent(
                                "Missing or oversized event"
                            );
                        }

                        let event;

                        try {
                            event = JSON.parse(
                                message.value.toString()
                            );
                        } catch {
                            throw new InvalidOrderEvent(
                                "Invalid JSON event"
                            );
                        }

                        const {
                            shipment,
                            created
                        } = await receiveOrder(event);

                        console.log(JSON.stringify({
                            event: created ?
                                "shipment_created" :
                                "shipment_duplicate",
                            oid: shipment.oid,
                            shipid: shipment.shipid,
                            event_id: shipment.event_id
                        }));
                    } catch (error) {
                        if (!(error instanceof InvalidOrderEvent)) {
                            throw error;
                        }

                        await db.collection("rejected_events")
                            .updateOne({
                                _id: topic + ":" +
                                    partition + ":" +
                                    message.offset
                            }, {
                                $setOnInsert: {
                                    reason: error.message,
                                    sample: message.value ?
                                        message.value.toString().slice(0, 4096) :
                                        null,
                                    createdAt: new Date()
                                }
                            }, {
                                upsert: true,
                                writeConcern: { w: 1, j: true }
                            });

                        console.error(JSON.stringify({
                            event: "shipment_event_rejected",
                            offset: message.offset
                        }));
                    }

                    await heartbeat();

                    await consumer.commitOffsets([{
                        topic,
                        partition,
                        offset: (
                            BigInt(message.offset) + BigInt(1)
                        ).toString()
                    }]);
                }
            });
        },

        async stop() {
            ready = false;
            await consumer.stop();
            await consumer.disconnect();
        }
    };
}

module.exports = { createOrderConsumer };