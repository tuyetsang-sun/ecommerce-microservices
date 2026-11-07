const { MongoClient } = require("mongodb");

function required(name) {
    const value = process.env[name];

    if (!value) {
        throw new Error("Missing environment variable: " + name);
    }

    return value;
}

const host = required("MONGO_HOST");
const port = Number(process.env.MONGO_PORT || 27017);
const database = required("MONGO_DATABASE");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid MONGO_PORT");
}

const client = new MongoClient(
    "mongodb://" + host + ":" + port, {
        replicaSet: process.env.MONGO_REPLICA_SET || undefined,
        auth: {
            username: required("MONGO_USERNAME"),
            password: required("MONGO_PASSWORD")
        },
        authSource: process.env.MONGO_AUTH_SOURCE || "admin",
        appName: "product-service",
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 2000,
        connectTimeoutMS: 2000,
        socketTimeoutMS: 3000,
        waitQueueTimeoutMS: 2000,
        retryWrites: false
    }
);

const db = client.db(database);

module.exports = { client, db };