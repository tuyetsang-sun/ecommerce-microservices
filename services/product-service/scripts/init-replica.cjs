const { MongoClient } = require("mongodb");

function required(name) {
    if (!process.env[name]) {
        throw new Error("Missing environment variable: " + name);
    }

    return process.env[name];
}

async function main() {
    const host = required("MONGO_HOST");
    const port = Number(process.env.MONGO_PORT || 27017);
    const setName = required("MONGO_REPLICA_SET");
    const member = host + ":" + port;

    const client = new MongoClient("mongodb://" + member, {
        directConnection: true,
        auth: {
            username: required("MONGO_USERNAME"),
            password: required("MONGO_PASSWORD")
        },
        authSource: process.env.MONGO_AUTH_SOURCE || "admin",
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        socketTimeoutMS: 20000,
        maxPoolSize: 1
    });

    try {
        await client.connect();

        const admin = client.db("admin");

        try {
            await admin.command({ replSetGetConfig: 1 });
        } catch (error) {
            if (error.code !== 94) throw error;

            try {
                await admin.command({
                    replSetInitiate: {
                        _id: setName,
                        members: [
                            { _id: 0, host: member }
                        ]
                    }
                });
            } catch (initError) {
                if (initError.code !== 23) throw initError;
            }
        }

        const result = await admin.command({
            replSetGetConfig: 1
        });

        const config = result.config;

        if (
            config._id !== setName ||
            config.members.length !== 1 ||
            config.members[0].host !== member
        ) {
            throw new Error("Unexpected replica set configuration");
        }

        for (let attempt = 0; attempt < 60; attempt++) {
            const hello = await admin.command({ hello: 1 });

            if (
                hello.setName === setName &&
                hello.isWritablePrimary === true
            ) {
                console.log(
                    "PRODUCT REPLICA SET READY: " + setName
                );

                return;
            }

            await new Promise(resolve => setTimeout(resolve, 500));
        }

        throw new Error("Replica set did not become PRIMARY");
    } finally {
        await client.close();
    }
}

main().catch(error => {
    console.error(
        "PRODUCT REPLICA INIT FAILED:",
        error.code || error.message
    );

    process.exitCode = 1;
});