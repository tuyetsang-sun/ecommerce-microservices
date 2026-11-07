const {
    normalizeOrderEvent
} = require("../domain/order-event");

function createReceiveOrder(shipments) {
    return event =>
        shipments.createFromOrder(
            normalizeOrderEvent(event)
        );
}

module.exports = { createReceiveOrder };