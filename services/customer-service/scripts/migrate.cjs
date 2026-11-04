const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { Client } = require("pg");

const migrations = ["001_customer_schema.sql"];

async function main() {
    for (const name of["PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD"]) {
        if (!process.env[name]) {
            throw new Error(`Missing ${name}`);
        }
    }

    const client = new Client({
        connectionTimeoutMillis: 5000,
        statement_timeout: 15000
    });

    try {
        await client.connect();
        await client.query("BEGIN");

        await client.query("SELECT pg_advisory_xact_lock(3003, 2)");

        await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version TEXT PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

        for (const version of migrations) {
            const file = path.join(__dirname, "../migrations", version);
            const sql = (await fs.readFile(file, "utf8"))
                .replace(/\r\n/g, "\n");

            const checksum = createHash("sha256")
                .update(sql)
                .digest("hex");

            const result = await client.query(
                "SELECT checksum FROM public.schema_migrations WHERE version = $1", [version]
            );

            if (result.rowCount > 0) {
                if (result.rows[0].checksum !== checksum) {
                    throw new Error(`Applied migration was modified: ${version}`);
                }

                console.log(`[migration] SKIP ${version}`);
                continue;
            }

            await client.query(sql);

            await client.query(
                "INSERT INTO public.schema_migrations(version, checksum) VALUES ($1, $2)", [version, checksum]
            );

            console.log(`[migration] APPLY ${version}`);
        }

        await client.query("COMMIT");
        console.log("CUSTOMER MIGRATIONS PASSED");
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        await client.end();
    }
}

main().catch(error => {
    console.error("CUSTOMER MIGRATIONS FAILED:", error.message);
    process.exitCode = 1;
});