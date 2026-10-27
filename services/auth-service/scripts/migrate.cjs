const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { Client } = require("pg");

const client = new Client({
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
  query_timeout: 20000
});

const migrationFiles = ["001_auth_schema.sql"];

async function main() {
  let inTransaction = false;
  const messages = [];

  try {
    await client.connect();
    await client.query("BEGIN");
    inTransaction = true;

    await client.query("SELECT pg_advisory_xact_lock(3003, 1)");

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version VARCHAR(100) PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const filename of migrationFiles) {
      const filePath = path.join(__dirname, "../migrations", filename);
      const sql = (await fs.readFile(filePath, "utf8")).replace(/\r\n/g, "\n");
      const checksum = createHash("sha256").update(sql).digest("hex");

      const previous = await client.query(
        "SELECT checksum FROM public.schema_migrations WHERE version = $1",
        [filename]
      );

      if (previous.rowCount > 0) {
        if (previous.rows[0].checksum !== checksum) {
          throw new Error("Applied migration was modified: " + filename);
        }

        messages.push("[migration] SKIP " + filename);
        continue;
      }

      await client.query(sql);

      await client.query(
        "INSERT INTO public.schema_migrations (version, checksum) VALUES ($1, $2)",
        [filename, checksum]
      );

      messages.push("[migration] APPLIED " + filename);
    }

    await client.query("COMMIT");
    inTransaction = false;

    messages.forEach((message) => console.log(message));
    console.log("AUTH MIGRATIONS PASSED");
  } catch (error) {
    if (inTransaction) {
      await client.query("ROLLBACK").catch(() => {});
    }

    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("AUTH MIGRATIONS FAILED:", error.message);
  process.exitCode = 1;
});
