async function main() {
    const port = process.env.PORT || 3000;

    const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(8000)
    });

    const body = await response.json();
    const dependencies = body && body.dependencies;

    if (!response.ok ||
        !body ||
        body.service !== "api-gateway" ||
        body.status !== "UP" ||
        !dependencies ||
        dependencies["auth-service"] !== "UP" ||
        dependencies.redis !== "UP"
    ) {
        throw new Error("Gateway dependencies are not healthy");
    }

    console.log(
        "HEALTH CHECK PASSED: api-gateway, auth-service and redis UP"
    );
}

main().catch(() => {
    console.error("HEALTH CHECK FAILED: api-gateway");
    process.exitCode = 1;
});