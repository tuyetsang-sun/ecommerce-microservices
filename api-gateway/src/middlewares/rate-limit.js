const { createHash } = require("node:crypto");
const { HttpError } = require("./error-handler");

const COUNT_REQUEST = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])

if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end

return {count, ttl}
`;

function createRateLimit({ executeRedis, scope, limit, windowMs }) {
    if (
        typeof executeRedis !== "function" ||
        typeof scope !== "string" ||
        !/^[a-zA-Z0-9:_-]+$/.test(scope) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        !Number.isSafeInteger(windowMs) ||
        windowMs < 1
    ) {
        throw new TypeError("Invalid rate limit configuration");
    }

    return async function rateLimit(req, res, next) {
        res.set("Cache-Control", "no-store");

        const ip = (req.ip || "unknown").replace(/^::ffff:/, "");
        const digest = createHash("sha256").update(ip).digest("hex");
        const key = `rl:v1:${scope}:${digest}`;

        let count;
        let ttl;

        try {
            const result = await executeRedis(redis => redis.eval(COUNT_REQUEST, {
                keys: [key],
                arguments: [String(windowMs)]
            }));

            if (!Array.isArray(result) || result.length !== 2) {
                throw new Error("Invalid Redis response");
            }

            [count, ttl] = result.map(Number);

            if (!Number.isSafeInteger(count) ||
                count < 1 ||
                !Number.isSafeInteger(ttl) ||
                ttl < 0
            ) {
                throw new Error("Invalid Redis counter");
            }
        } catch {
            return next(new HttpError(
                503,
                "Rate limit service unavailable"
            ));
        }

        const waitSeconds = Math.max(1, Math.ceil(ttl / 1000));

        res.set("X-RateLimit-Limit", String(limit));
        res.set("X-RateLimit-Remaining", String(Math.max(0, limit - count)));

        if (count > limit) {
            res.set("Retry-After", String(waitSeconds));

            return next(new HttpError(
                429,
                "Too many requests. Please try again later."
            ));
        }

        return next();
    };
}

module.exports = { createRateLimit };