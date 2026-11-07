const { pool } = require("../src/infrastructure/db");

async function main() {
    const text = process.argv[2] || "";

    if (!/^[1-9][0-9]{0,9}$/.test(text) ||
        Number(text) > 2147483647
    ) {
        throw new Error("Pass a valid order ID");
    }

    try {
        const result = await pool.query(`
          SELECT event_id, oid, event_type,
                 attempts, published_at, last_error
          FROM order_outbox
          WHERE oid=$1
        `, [Number(text)]);

        console.table(result.rows);

        if (
            result.rowCount !== 1 ||
            !result.rows[0].published_at
        ) {
            throw new Error("Event is not published yet");
        }

        console.log("ORDER EVENT CHECK PASSED");
    } finally {
        await pool.end();
    }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});