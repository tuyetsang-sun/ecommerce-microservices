const fs = require("node:fs/promises");
const path = require("node:path");
const { Client } = require("pg");

async function main() {
    const client = new Client({
        connectionTimeoutMillis: 5000,
        statement_timeout: 10000,
        query_timeout: 15000
    });

    client.on("notice", notice => {
        console.log(notice.message);
    });

    try {
        await client.connect();

        const sql = await fs.readFile(
            path.join(__dirname, "../tests/order-schema.sql"),
            "utf8"
        );

        await client.query(sql);

        console.log(
            "ORDER SCHEMA CHECK PASSED: test rows rolled back"
        );
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        await client.end();
    }
}

main().catch(error => {
    console.error(
        "ORDER SCHEMA CHECK FAILED:",
        error.message
    );

    process.exitCode = 1;
});