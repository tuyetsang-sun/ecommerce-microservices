const { randomUUID } = require("node:crypto");

function createProductCache({ executeRedis, ttlSeconds = 30 }) {
    if (
        typeof executeRedis !== "function" ||
        !Number.isInteger(ttlSeconds) ||
        ttlSeconds < 1
    ) {
        throw new TypeError("Invalid product cache configuration");
    }

    // Phù hợp cấu hình MVP hiện tại: một tiến trình Gateway.
    let generation = randomUUID();
    let pendingWrites = 0;

    async function read(name, load) {
        if (pendingWrites > 0) {
            return { value: await load(), status: "BYPASS" };
        }

        const version = generation;
        const key = "cache:product:v1:" + version + ":" + name;
        let raw;

        try {
            raw = await executeRedis(redis => redis.get(key));
        } catch {
            return { value: await load(), status: "BYPASS" };
        }

        if (version !== generation || pendingWrites > 0) {
            return { value: await load(), status: "BYPASS" };
        }

        if (raw !== null) {
            try {
                const cached = JSON.parse(raw);

                if (
                    cached &&
                    Number.isSafeInteger(cached.expiresAt) &&
                    cached.expiresAt > Date.now() &&
                    Object.hasOwn(cached, "value")
                ) {
                    return { value: cached.value, status: "HIT" };
                }
            } catch {
                // Cache không hợp lệ: đọc lại từ Product Service.
            }
        }

        const value = await load();

        if (version !== generation || pendingWrites > 0) {
            return { value, status: "BYPASS" };
        }

        const payload = JSON.stringify({
            expiresAt: Date.now() + ttlSeconds * 1000,
            value
        });

        // Không cache response lớn hơn 256 KB.
        if (Buffer.byteLength(payload, "utf8") > 262144) {
            return { value, status: "BYPASS" };
        }

        try {
            await executeRedis(redis =>
                redis.set(key, payload, { EX: ttlSeconds })
            );
        } catch {
            return { value, status: "BYPASS" };
        }

        return {
            value,
            status: version === generation && pendingWrites === 0 ?
                "MISS" :
                "BYPASS"
        };
    }

    async function mutate(run) {
        pendingWrites++;
        generation = randomUUID();

        try {
            return await run();
        } finally {
            generation = randomUUID();
            pendingWrites--;
        }
    }

    return { read, mutate };
}

module.exports = { createProductCache };