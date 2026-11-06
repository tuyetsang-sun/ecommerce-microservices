const { pool } = require("../src/infrastructure/db");

async function main() {
    const username = (process.argv[2] || "").trim();

    if (process.argv.length !== 3 || !username ||
        username.length > 50 || username.includes("\u0000")) {
        console.error("Usage: node scripts/grant-admin.cjs <username>");
        process.exitCode = 1;
        return;
    }

    const result = await pool.query(
        `UPDATE public.users AS u
         SET roleid = r.roleid
         FROM public.roles AS r
         WHERE lower(u.username) = lower($1)
           AND r.rolename = $2
         RETURNING u.uid, u.username, r.rolename AS role`, [username, "admin"]
    );

    if (result.rowCount !== 1) {
        console.error("ADMIN GRANT FAILED: username or admin role not found");
        process.exitCode = 1;
        return;
    }

    console.log("ADMIN GRANT PASSED:", JSON.stringify(result.rows[0]));
}

main()
    .catch(error => {
        console.error("ADMIN GRANT FAILED:", error.code || "UNKNOWN");
        process.exitCode = 1;
    })
    .finally(() => pool.end());