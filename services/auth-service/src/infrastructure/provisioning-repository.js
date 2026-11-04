function createProvisioningRepository(db) {
    return {
        async claimNext() {
            const result = await db.query(`
        WITH due AS (
          SELECT uid
          FROM public.customer_provisioning
          WHERE processed_at IS NULL
            AND next_attempt_at <= NOW()
          ORDER BY next_attempt_at, uid
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE public.customer_provisioning AS p
        SET attempts = p.attempts + 1,
            next_attempt_at = NOW() + INTERVAL '30 seconds'
        FROM due
        WHERE p.uid = due.uid
        RETURNING p.uid, p.fullname, p.attempts
      `);

            return result.rows[0] || null;
        },

        async complete(uid, attempt) {
            const result = await db.query(
                `UPDATE public.customer_provisioning
         SET processed_at = NOW()
         WHERE uid = $1
           AND attempts = $2
           AND processed_at IS NULL`, [uid, attempt]
            );

            return result.rowCount === 1;
        },

        async retry(uid, attempt, delayMs) {
            const result = await db.query(
                `UPDATE public.customer_provisioning
         SET next_attempt_at =
           NOW() + ($3::int * INTERVAL '1 millisecond')
         WHERE uid = $1
           AND attempts = $2
           AND processed_at IS NULL`, [uid, attempt, delayMs]
            );

            return result.rowCount === 1;
        }
    };
}

module.exports = { createProvisioningRepository };