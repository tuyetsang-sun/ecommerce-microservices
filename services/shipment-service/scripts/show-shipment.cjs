const { client, db } = require("../src/infrastructure/db");

async function main() {
    const text = process.argv[2] || "";

    if (!/^[1-9][0-9]{0,9}$/.test(text) ||
        Number(text) > 2147483647
    ) {
        throw new Error("Pass a valid order ID");
    }

    const oid = Number(text);

    try {
        const rows = await db.collection("shipments")
            .find({ oid })
            .project({ _id: 0, event_hash: 0 })
            .toArray();

        if (rows.length !== 1) {
            throw new Error(
                "Expected one shipment; found " + rows.length
            );
        }

        console.log(JSON.stringify(rows[0], null, 2));

        console.log(
            "SHIPMENT CHECK PASSED: exactly one shipment for order " +
            oid
        );
    } finally {
        await client.close();
    }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});