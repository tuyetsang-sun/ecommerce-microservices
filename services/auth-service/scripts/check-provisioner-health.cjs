const fs = require("node:fs");

try {
    const ageMs =
        Date.now() -
        fs.statSync("/tmp/auth-provisioner-heartbeat").mtimeMs;

    if (ageMs < 0 || ageMs > 20000) {
        throw new Error("Heartbeat expired");
    }

    console.log("HEALTH CHECK PASSED: auth-provisioner UP");
} catch {
    console.error(
        "HEALTH CHECK FAILED: auth-provisioner heartbeat unavailable"
    );

    process.exitCode = 1;
}