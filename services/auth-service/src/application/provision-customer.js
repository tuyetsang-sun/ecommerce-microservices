function createCustomerProvisioner({ jobs, ensureCustomer }) {
    async function runOnce() {
        const job = await jobs.claimNext();

        if (!job) {
            return { status: "idle" };
        }

        try {
            await ensureCustomer({
                uid: job.uid,
                fullname: job.fullname
            });
        } catch (error) {
            const delayMs = Math.min(
                60000,
                1000 * 2 ** Math.min(job.attempts - 1, 6)
            );

            const saved = await jobs.retry(
                job.uid,
                job.attempts,
                delayMs
            );

            return {
                status: saved ? "retry" : "stale",
                uid: job.uid,
                attempt: job.attempts,
                delayMs,
                code: String(error.code || "RPC_ERROR")
            };
        }

        const saved = await jobs.complete(
            job.uid,
            job.attempts
        );

        return {
            status: saved ? "done" : "stale",
            uid: job.uid,
            attempt: job.attempts
        };
    }

    return { runOnce };
}

module.exports = { createCustomerProvisioner };