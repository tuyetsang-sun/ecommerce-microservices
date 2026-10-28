const { AuthError } = require("../domain/auth-error");

function createUserRepository(pool) {
    async function createNormalUser(data) {
        const client = await pool.connect();
        let discardClient = false;

        try {
            await client.query("BEGIN");

            const result = await client.query(
                `INSERT INTO public.users
          (username, password_hash, email, phone, roleid)
         VALUES ($1, $2, $3, $4, 1)
         RETURNING uid`, [data.username, data.passwordHash, data.email, data.phone]
            );

            const uid = result.rows[0].uid;

            await client.query(
                `INSERT INTO public.customer_provisioning (uid, fullname)
         VALUES ($1, $2)`, [uid, data.fullname]
            );

            await client.query("COMMIT");

            return { uid };
        } catch (error) {
            try {
                await client.query("ROLLBACK");
            } catch {
                discardClient = true;
            }

            if (
                error.code === "23505" && ["users_username_unique", "users_email_unique"].includes(
                    error.constraint
                )
            ) {
                throw new AuthError(
                    "CONFLICT",
                    "Username or email already exists"
                );
            }

            throw error;
        } finally {
            client.release(discardClient);
        }
    }

    async function findByUsername(username) {
        const result = await pool.query(
            `SELECT u.uid, u.username, u.password_hash AS "passwordHash",
              r.rolename AS role
       FROM public.users AS u
       JOIN public.roles AS r ON r.roleid = u.roleid
       WHERE lower(u.username) = lower($1)`, [username]
        );

        return result.rows[0] || null;
    }

    async function findIdentityById(uid) {
        const result = await pool.query(
            `SELECT u.uid, u.username, r.rolename AS role
       FROM public.users AS u
       JOIN public.roles AS r ON r.roleid = u.roleid
       WHERE u.uid = $1`, [uid]
        );

        return result.rows[0] || null;
    }

    return {
        createNormalUser,
        findByUsername,
        findIdentityById
    };
}

module.exports = { createUserRepository };