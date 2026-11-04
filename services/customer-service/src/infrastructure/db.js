const { Pool } = require("pg");

for (const name of["PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD"]) {
    if (!process.env[name]) {
        throw new Error(`Missing ${name}`);
    }
}

const pool = new Pool({
    max: 5,
    connectionTimeoutMillis: 2000,
    query_timeout: 2000,
    statement_timeout: 2000,
    idleTimeoutMillis: 30000
});

pool.on("error", error => {
    console.error(JSON.stringify({
        event: "customer_database_error",
        code: error.code || "DATABASE_ERROR"
    }));
});

module.exports = { pool };