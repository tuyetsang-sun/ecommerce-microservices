async function main() {
    const port = process.env.PORT || "3000";

    const response = await fetch("http://127.0.0.1:" + port + "/health", {
        signal: AbortSignal.timeout(7000)
    });

    if (!response.ok) {
        throw new Error("HTTP " + response.status);
    }

    const body = await response.json();

    if (
        body.service !== "api-gateway" ||
        body.status !== "UP" ||
        !body.dependencies ||
        body.dependencies["auth-service"] !== "UP"
    ) {
        throw new Error("Unexpected health response");
    }

    console.log("HEALTH CHECK PASSED: gateway -> auth-service -> auth-db");
}

main().catch((error) => {
    console.error("HEALTH CHECK FAILED:", error.message);
    process.exitCode = 1;
});