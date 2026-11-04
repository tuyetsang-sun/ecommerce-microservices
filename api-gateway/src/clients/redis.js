const { createClient } = require("redis");

if (!process.env.REDIS_PASSWORD) {
    throw new Error("REDIS_PASSWORD is required");
}

const client = createClient({
    socket: {
        host: process.env.REDIS_HOST || "redis",
        port: Number(process.env.REDIS_PORT || 6379),
        connectTimeout: 2000,
        reconnectStrategy: retries => Math.min((retries + 1) * 250, 2000)
    },
    password: process.env.REDIS_PASSWORD,
    disableOfflineQueue: true,
    commandsQueueMaxLength: 512
});

client.on("error", error => {
    console.error(JSON.stringify({
        event: "redis_error",
        code: error.code || "REDIS_ERROR"
    }));
});

async function connectRedis() {
    if (!client.isOpen) await client.connect();
}

async function executeRedis(command) {
    if (!client.isReady) throw new Error("Redis is not ready");

    let timer;

    try {
        return await Promise.race([
            command(client),
            new Promise((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error("Redis timeout")),
                    2000
                );
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
}

async function checkRedisHealth() {
    if (await executeRedis(redis => redis.ping()) !== "PONG") {
        throw new Error("Unexpected Redis health response");
    }
}

function closeRedis() {
    if (client.isOpen) client.destroy();
}

module.exports = {
    connectRedis,
    executeRedis,
    checkRedisHealth,
    closeRedis
};