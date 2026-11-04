const rules = require("../domain/customer-rules");

function createCustomerUseCases({ customers, memberships }) {
    // Internal provisioning only.
    // The transport layer must authenticate Auth Service.
    async function ensureCustomer(input) {
        rules.object(input);

        return customers.ensure({
            uid: rules.positiveId(input.uid, "uid"),
            fullname: rules.initialFullname(input.fullname)
        });
    }

    // actor comes from verified authentication, never from request JSON.
    async function getCustomer(input, actor) {
        rules.requireActor(actor);
        rules.object(input);

        const uid = rules.positiveId(input.uid, "uid");
        rules.requireOwnerOrAdmin(actor, uid);

        const customer = await customers.findById(uid);

        if (!customer) {
            rules.fail("NOT_FOUND", "Customer not found");
        }

        return customer;
    }

    async function updateCustomer(input, actor) {
        rules.requireActor(actor);
        rules.object(input);

        const uid = rules.positiveId(input.uid, "uid");
        rules.requireOwnerOrAdmin(actor, uid);

        const patch = {};

        if (rules.has(input, "mid")) {
            rules.requireAdmin(actor);
            patch.mid = rules.positiveId(input.mid, "mid");
        }

        if (rules.has(input, "fullname")) {
            patch.fullname = rules.text(input.fullname, "fullname", 100);
        }

        if (Object.keys(patch).length === 0) {
            rules.fail("VALIDATION_ERROR", "No supported fields to update");
        }

        if (!await customers.findById(uid)) {
            rules.fail("NOT_FOUND", "Customer not found");
        }

        if (
            rules.has(patch, "mid") &&
            !await memberships.findById(patch.mid)
        ) {
            rules.fail("VALIDATION_ERROR", "Membership does not exist");
        }

        const customer = await customers.update(uid, patch);

        if (!customer) {
            rules.fail("NOT_FOUND", "Customer not found");
        }

        return customer;
    }

    async function getMembership(input, actor) {
        const customer = await getCustomer(input, actor);
        const membership = await memberships.findById(customer.mid);

        if (!membership) {
            rules.fail("NOT_FOUND", "Membership not found");
        }

        return membership;
    }

    async function listMemberships(actor) {
        rules.requireActor(actor);
        return memberships.list();
    }

    async function createMembership(input, actor) {
        rules.requireAdmin(actor);
        rules.object(input);

        return memberships.create({
            mname: rules.text(input.mname, "mname", 50),
            score: rules.score(input.score)
        });
    }

    async function updateMembership(input, actor) {
        rules.requireAdmin(actor);
        rules.object(input);

        const mid = rules.positiveId(input.mid, "mid");
        const patch = {};

        if (rules.has(input, "mname")) {
            patch.mname = rules.text(input.mname, "mname", 50);
        }

        if (rules.has(input, "score")) {
            patch.score = rules.score(input.score);
        }

        if (Object.keys(patch).length === 0) {
            rules.fail("VALIDATION_ERROR", "No supported fields to update");
        }

        const membership = await memberships.update(mid, patch);

        if (!membership) {
            rules.fail("NOT_FOUND", "Membership not found");
        }

        return membership;
    }

    return {
        ensureCustomer,
        getCustomer,
        updateCustomer,
        getMembership,
        listMemberships,
        createMembership,
        updateMembership
    };
}

module.exports = { createCustomerUseCases };