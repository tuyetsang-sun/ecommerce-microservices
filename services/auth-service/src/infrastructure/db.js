const { Pool } = require("pg");

const pool = new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max: 5,
    connectionTimeoutMillis: 2000,
    query_timeout: 2000,
    statement_timeout: 2000,
    idleTimeoutMillis: 30000
});

pool.on("error", (error) => {
    console.error("[auth-db] Connection error:", error.code || "UNKNOWN");
});

module.exports = { pool };