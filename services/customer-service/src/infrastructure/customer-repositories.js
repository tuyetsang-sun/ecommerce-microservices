const { CustomerError } = require("../domain/customer-error");

function createCustomerRepositories(db) {
    async function query(sql, values = []) {
        try {
            return await db.query(sql, values);
        } catch (error) {
            if (
                error.code === "23505" &&
                error.constraint === "memberships_name_unique"
            ) {
                throw new CustomerError(
                    "CONFLICT",
                    "Membership name already exists"
                );
            }

            if (
                error.code === "23503" &&
                error.constraint === "customers_membership_fk"
            ) {
                throw new CustomerError(
                    "VALIDATION_ERROR",
                    "Membership does not exist"
                );
            }

            throw error;
        }
    }

    async function one(sql, values) {
        const result = await query(sql, values);
        return result.rows[0] || null;
    }

    // Table and column names come only from fixed lists in this module.
    async function update(
        table,
        idColumn,
        columns,
        returning,
        id,
        patch
    ) {
        const values = [id];
        const assignments = [];

        for (const column of columns) {
            if (
                Object.prototype.hasOwnProperty.call(patch, column) &&
                patch[column] !== undefined
            ) {
                values.push(patch[column]);
                assignments.push(`${column} = $${values.length}`);
            }
        }

        if (assignments.length === 0) {
            throw new CustomerError(
                "VALIDATION_ERROR",
                "No supported fields to update"
            );
        }

        return one(
            `UPDATE public.${table}
       SET ${assignments.join(", ")}
       WHERE ${idColumn} = $1
       RETURNING ${returning}`,
            values
        );
    }

    const customers = {
        ensure({ uid, fullname }) {
            return one(
                `INSERT INTO public.customers (uid, fullname)
         VALUES ($1, $2)
         ON CONFLICT (uid)
         DO UPDATE SET uid = EXCLUDED.uid
         RETURNING uid, fullname, mid`, [uid, fullname]
            );
        },

        findById(uid) {
            return one(
                `SELECT uid, fullname, mid
         FROM public.customers
         WHERE uid = $1`, [uid]
            );
        },

        update(uid, patch) {
            return update(
                "customers",
                "uid", ["fullname", "mid"],
                "uid, fullname, mid",
                uid,
                patch
            );
        }
    };

    const memberships = {
        findById(mid) {
            return one(
                `SELECT mid, mname, score
         FROM public.memberships
         WHERE mid = $1`, [mid]
            );
        },

        async list() {
            const result = await query(
                `SELECT mid, mname, score
         FROM public.memberships
         ORDER BY mid`
            );

            return result.rows;
        },

        create({ mname, score }) {
            return one(
                `INSERT INTO public.memberships (mname, score)
         VALUES ($1, $2)
         RETURNING mid, mname, score`, [mname, score]
            );
        },

        update(mid, patch) {
            return update(
                "memberships",
                "mid", ["mname", "score"],
                "mid, mname, score",
                mid,
                patch
            );
        }
    };

    return { customers, memberships };
}

module.exports = { createCustomerRepositories };