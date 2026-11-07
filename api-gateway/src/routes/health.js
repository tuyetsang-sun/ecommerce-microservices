const { checkProductHealth } = require("../clients/product");
const express = require("express");
const { checkAuthHealth } = require("../clients/auth-health");
const { checkRedisHealth } = require("../clients/redis");
const {
    checkCustomerHealth
} = require("../clients/customer");
const healthRouter = express.Router();
const { checkOrderHealth } = require("../clients/order");
const {
    checkShipmentHealth
} = require("../clients/shipment-health");
healthRouter.get("/health/live", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({
        service: "api-gateway",
        status: "UP"
    });
});

healthRouter.get("/health", async(req, res) => {
    res.set("Cache-Control", "no-store");

    const results = await Promise.allSettled([
        checkAuthHealth(),
        checkRedisHealth(),
        checkCustomerHealth(),
        checkProductHealth(),
        checkOrderHealth(),
        checkShipmentHealth()
    ]);

    const names = ["auth-service", "redis", "customer-service", "product-service", "order-service", "shipment-service"];
    const dependencies = {};

    results.forEach((result, index) => {
        dependencies[names[index]] =
            result.status === "fulfilled" ? "UP" : "DOWN";

        if (result.status === "rejected") {
            console.error(JSON.stringify({
                event: "dependency_health_failed",
                requestId: req.requestId,
                dependency: names[index],
                code: (result.reason && result.reason.code) || "UNAVAILABLE"
            }));
        }
    });

    const healthy = results.every(
        result => result.status === "fulfilled"
    );

    res.status(healthy ? 200 : 503).json({
        service: "api-gateway",
        status: healthy ? "UP" : "DEGRADED",
        dependencies
    });
});

module.exports = { healthRouter };