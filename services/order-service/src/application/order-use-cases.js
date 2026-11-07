const { randomUUID } = require("node:crypto");
const { normalizeCreateOrder } = require("../domain/order-rules");
const { OrderError } = require("../domain/order-error");
const { priceOrder } = require("./price-order");

const fail = (code, details) => {
    throw Object.assign(new Error(details), { code, details });
};

function createOrderUseCases({ pool, remote }) {
    const selectOrders = `
      SELECT o.*, COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'pid', d.pid,
          'qty', d.qty,
          'unit_price', d.unit_price::text
        ) ORDER BY d.pid)
        FROM order_details d
        WHERE d.oid = o.oid
      ), '[]'::jsonb) AS items
      FROM orders o
    `;

    function dto(row) {
        return {
            oid: row.oid,
            uid: row.uid,
            score: row.score,
            discount: row.discount_rate,
            discount_rate: row.discount_rate,
            discount_amount: row.discount_amount,
            subtotal: row.subtotal,
            total_amount: row.total_amount,
            items: row.items
        };
    }

    async function processRequest(id) {
        const c = await pool.connect();
        let locked = false;
        let destroy = false;
        const lockKey = "order-request:" + id;

        try {
            const lock = await c.query(
                `SELECT pg_try_advisory_lock(
                    hashtextextended($1, 0)
                ) AS locked`, [lockKey]
            );

            locked = lock.rows[0].locked;
            if (!locked) return;

            for (let step = 0; step < 3; step += 1) {
                const r = (await c.query(
                    "SELECT * FROM order_requests WHERE reservation_id=$1", [id]
                )).rows[0];

                if (!r || ["DONE", "FAILED"].includes(r.state)) {
                    return;
                }

                if (r.state === "PENDING") {
                    let quote;

                    try {
                        const held = await remote.reserveStock({
                            reservation_id: id,
                            items: r.items
                        });

                        if (held.reservation_id !== id) {
                            throw new OrderError(
                                "INVALID_PRODUCT_RESPONSE",
                                "Invalid reservation response"
                            );
                        }

                        quote = priceOrder({
                            items: r.items,
                            reservedItems: held.items,
                            membership: r.membership
                        });
                    } catch (error) {
                        if (![3, 5, 9].includes(error.code) &&
                            !(error instanceof OrderError)
                        ) {
                            throw error;
                        }

                        const code = [3, 5, 9].includes(error.code) ?
                            error.code :
                            13;

                        const message = code === 13 ?
                            "Invalid pricing response" :
                            error.details;

                        await c.query(`
                          UPDATE order_requests
                          SET state='COMPENSATING',
                              failure_code=$2,
                              failure_message=$3
                          WHERE reservation_id=$1
                        `, [id, code, message]);

                        continue;
                    }

                    try {
                        await c.query("BEGIN");

                        const order = (await c.query(`
                          INSERT INTO orders (
                            uid, score, discount_rate, subtotal,
                            discount_amount, total_amount,
                            idempotency_key, request_hash,
                            reservation_id
                          )
                          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                          RETURNING *
                        `, [
                            r.uid,
                            quote.score,
                            quote.discount_rate,
                            quote.subtotal,
                            quote.discount_amount,
                            quote.total_amount,
                            r.idempotency_key,
                            r.request_hash,
                            id
                        ])).rows[0];

                        await c.query(`
                          INSERT INTO order_details (
                            oid, pid, qty, unit_price
                          )
                          SELECT $1, x.pid, x.qty, x.unit_price
                          FROM jsonb_to_recordset($2::jsonb)
                          AS x (
                            pid integer,
                            qty integer,
                            unit_price numeric
                          )
                        `, [
                            order.oid,
                            JSON.stringify(quote.items)
                        ]);

                        const eventId = randomUUID();

                        const payload = {
                            event_id: eventId,
                            event_type: "order-created",
                            ...dto({
                                ...order,
                                items: quote.items
                            })
                        };

                        await c.query(`
                          INSERT INTO order_outbox (
                            event_id, oid, payload
                          )
                          VALUES ($1,$2,$3::jsonb)
                        `, [
                            eventId,
                            order.oid,
                            JSON.stringify(payload)
                        ]);

                        await c.query(`
                          UPDATE order_requests
                          SET state='CONFIRMING'
                          WHERE reservation_id=$1
                        `, [id]);

                        await c.query("COMMIT");
                    } catch (error) {
                        await c.query("ROLLBACK").catch(() => {});

                        // Không hoàn kho khi chưa xác định được
                        // COMMIT đã thành công hay chưa.
                        throw error;
                    }

                    continue;
                }

                if (r.state === "CONFIRMING") {
                    const result = await remote.confirmStock({
                        reservation_id: id
                    });

                    if (
                        result.message !==
                        "Stock confirmed successfully"
                    ) {
                        fail(14, "Invalid stock confirmation");
                    }

                    await c.query(`
                      UPDATE order_requests
                      SET state='DONE'
                      WHERE reservation_id=$1
                    `, [id]);

                    return;
                }

                const result = await remote.releaseStock({
                    reservation_id: id
                });

                if (
                    result.message !==
                    "Stock released successfully"
                ) {
                    fail(14, "Invalid stock release");
                }

                await c.query(`
                  UPDATE order_requests
                  SET state='FAILED'
                  WHERE reservation_id=$1
                `, [id]);

                return;
            }
        } catch (error) {
            await c.query(`
              UPDATE order_requests
              SET next_attempt_at=NOW()+INTERVAL '5 seconds'
              WHERE reservation_id=$1
                AND state NOT IN ('DONE','FAILED')
            `, [id]).catch(() => {});

            throw error;
        } finally {
            if (locked) {
                try {
                    await c.query(
                        "SELECT pg_advisory_unlock(hashtextextended($1,0))", [lockKey]
                    );
                } catch {
                    destroy = true;
                }
            }

            c.release(destroy);
        }
    }

    async function create(input, actor, token) {
        const request = normalizeCreateOrder(input);
        const args = [actor.uid, request.idempotency_key];

        const lookup = `
          SELECT * FROM order_requests
          WHERE uid=$1 AND idempotency_key=$2
        `;

        let row = (await pool.query(lookup, args)).rows[0];

        if (!row) {
            const membership = await remote.getMembership(
                actor.uid,
                token
            );

            await pool.query(`
              INSERT INTO order_requests (
                reservation_id, uid, idempotency_key,
                request_hash, items, membership
              )
              VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)
              ON CONFLICT (uid,idempotency_key) DO NOTHING
            `, [
                randomUUID(),
                actor.uid,
                request.idempotency_key,
                request.request_hash,
                JSON.stringify(request.items),
                JSON.stringify(membership)
            ]);

            row = (await pool.query(lookup, args)).rows[0];
        }

        if (row.request_hash !== request.request_hash) {
            fail(
                9,
                "Idempotency-Key was used for different items"
            );
        }

        await processRequest(row.reservation_id);

        row = (await pool.query(lookup, args)).rows[0];

        if (row.state === "FAILED") {
            fail(row.failure_code, row.failure_message);
        }

        if (row.state !== "DONE") {
            fail(
                14,
                "Order processing; retry with the same Idempotency-Key"
            );
        }

        const saved = await pool.query(
            selectOrders + " WHERE o.reservation_id=$1", [row.reservation_id]
        );

        return dto(saved.rows[0]);
    }

    async function list(actor) {
        const result = await pool.query(
            selectOrders +
            " WHERE o.uid=$1 ORDER BY o.oid DESC LIMIT 100", [actor.uid]
        );

        return { items: result.rows.map(dto) };
    }

    async function get(input, actor) {
        if (!Number.isInteger(input.oid) ||
            input.oid < 1 ||
            input.oid > 2147483647
        ) {
            fail(3, "Invalid order ID");
        }

        const result = await pool.query(
            selectOrders + " WHERE o.oid=$1 AND o.uid=$2", [input.oid, actor.uid]
        );

        if (!result.rowCount) {
            fail(5, "Order not found");
        }

        return dto(result.rows[0]);
    }

    let busy = false;

    async function recover() {
        if (busy) return;
        busy = true;

        try {
            const rows = await pool.query(`
              SELECT reservation_id
              FROM order_requests
              WHERE state IN (
                'PENDING','CONFIRMING','COMPENSATING'
              )
                AND next_attempt_at <= NOW()
              ORDER BY next_attempt_at
              LIMIT 10
            `);

            for (const row of rows.rows) {
                try {
                    await processRequest(row.reservation_id);
                } catch (error) {
                    console.error(JSON.stringify({
                        event: "order_retry",
                        code: error.code || "INTERNAL"
                    }));
                }
            }
        } finally {
            busy = false;
        }
    }

    function startRecovery() {
        const tick = () => recover().catch(error => {
            console.error(JSON.stringify({
                event: "order_recovery_failed",
                code: error.code || "INTERNAL"
            }));
        });

        const timer = setInterval(tick, 5000);
        timer.unref();
        tick();

        return () => clearInterval(timer);
    }

    return {
        create,
        list,
        get,
        recover,
        startRecovery
    };
}

module.exports = { createOrderUseCases };