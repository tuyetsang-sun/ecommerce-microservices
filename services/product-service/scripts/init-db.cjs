const { client, db } = require("../src/infrastructure/db");

const {
    initializeProductDatabase
} = require("../src/infrastructure/product-repository");

const {
    initializeStockDatabase
} = require("../src/infrastructure/stock-repository");

async function main() {
    try {
        await initializeProductDatabase(db);
        await initializeStockDatabase(db);

        console.log("PRODUCT DATABASE INIT PASSED");
    } finally {
        await client.close();
    }
}

main().catch(error => {
    console.error(
        "PRODUCT DATABASE INIT FAILED:",
        error.code || error.name
    );

    process.exitCode = 1;
});