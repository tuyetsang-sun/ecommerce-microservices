const { Pool } = require("pg");

for (const key of[
        "PGHOST",
        "PGDATABASE",
        "PGUSER",
        "PGPASSWORD"
    ]) {
    if (!process.env[key]) {
        throw new Error("Missing environment variable: " + key);
    }
}

const port = Number(process.env.PGPORT || 5432);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid PGPORT");
}

const pool = new Pool({
    host: process.env.PGHOST,
    port,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max: 5,
    connectionTimeoutMillis: 2000,
    query_timeout: 2000,
    statement_timeout: 2000,
    idleTimeoutMillis: 30000
});

pool.on("error", error => {
    console.error(JSON.stringify({
        event: "order_db_connection_error",
        code: error.code || "UNKNOWN"
    }));
});

module.exports = { pool };