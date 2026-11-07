const { Kafka, Partitioners, logLevel } = require("kafkajs");

function createOutboxPublisher({ pool }) {
    const kafka = new Kafka({
        clientId: "order-outbox",
        brokers: (process.env.KAFKA_BROKERS || "kafka:9092").split(","),
        connectionTimeout: 3000,
        requestTimeout: 10000,
        retry: { retries: 2 },
        logLevel: logLevel.ERROR
    });

    const producer = kafka.producer({
        allowAutoTopicCreation: false,
        createPartitioner: Partitioners.DefaultPartitioner
    });

    let active;
    let timer;
    let stopping = false;

    async function publish() {
        await producer.connect();

        const c = await pool.connect();
        let rows = [];
        let destroy = false;

        try {
            await c.query("BEGIN");

            rows = (await c.query(`
              SELECT e.event_id, e.oid, e.payload
              FROM order_outbox e
              JOIN orders o ON o.oid=e.oid
              JOIN order_requests r
                ON r.reservation_id=o.reservation_id
              WHERE e.published_at IS NULL
                AND e.next_attempt_at <= NOW()
                AND r.state='DONE'
              ORDER BY e.created_at, e.event_id
              LIMIT 10
              FOR UPDATE OF e SKIP LOCKED
            `)).rows;

            if (rows.length) {
                await producer.send({
                    topic: "order-created",
                    acks: -1,
                    timeout: 10000,
                    messages: rows.map(row => ({
                        key: String(row.oid),
                        value: JSON.stringify(row.payload)
                    }))
                });

                await c.query(`
                  UPDATE order_outbox
                  SET published_at=NOW(),
                      attempts=attempts+1,
                      last_error=NULL
                  WHERE event_id=ANY($1::uuid[])
                `, [rows.map(row => row.event_id)]);
            }

            await c.query("COMMIT");

            for (const row of rows) {
                console.log(JSON.stringify({
                    event: "order-created",
                    status: "published",
                    oid: row.oid,
                    event_id: row.event_id
                }));
            }
        } catch (error) {
            try {
                await c.query("ROLLBACK");

                if (rows.length) {
                    await c.query(`
                      UPDATE order_outbox
                      SET attempts=attempts+1,
                          next_attempt_at=NOW()+INTERVAL '5 seconds',
                          last_error=$2
                      WHERE event_id=ANY($1::uuid[])
                        AND published_at IS NULL
                    `, [
                        rows.map(row => row.event_id),
                        String(
                            error.code || error.name || "PUBLISH_FAILED"
                        ).slice(0, 100)
                    ]);
                }
            } catch {
                destroy = true;
            }

            throw error;
        } finally {
            c.release(destroy);
        }
    }

    function tick() {
        if (stopping || active) return;

        active = publish()
            .catch(error => {
                console.error(JSON.stringify({
                    event: "outbox_retry",
                    code: error.code || error.name
                }));
            })
            .finally(() => {
                active = null;
            });
    }

    return {
        start() {
            timer = setInterval(tick, 2000);
            timer.unref();
            tick();
        },

        async stop() {
            stopping = true;
            clearInterval(timer);

            if (active) await active;

            await producer.disconnect();
        }
    };
}

module.exports = { createOutboxPublisher };