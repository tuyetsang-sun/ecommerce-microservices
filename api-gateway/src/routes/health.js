const express = require("express");
const { checkAuthHealth } = require("../clients/auth-health");

const router = express.Router();

router.get("/health/live", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({
        service: "api-gateway",
        status: "UP"
    });
});

router.get("/health", async(req, res) => {
    res.set("Cache-Control", "no-store");

    try {
        await checkAuthHealth();

        res.status(200).json({
            service: "api-gateway",
            status: "UP",
            dependencies: {
                "auth-service": "UP"
            }
        });
    } catch (error) {
        console.error(JSON.stringify({
            event: "dependency_health_failed",
            requestId: req.requestId,
            dependency: "auth-service",
            code: error.code || "UNKNOWN"
        }));

        res.status(503).json({
            service: "api-gateway",
            status: "DEGRADED",
            dependencies: {
                "auth-service": "DOWN"
            }
        });
    }
});

module.exports = router;