const rules = require("../domain/product-rules");

function createProductUseCases({ products }) {
    // actor must come from verified authentication, never from request JSON.

    function productId(input) {
        rules.object(input);
        return rules.integer(input.pid, 1, "pid");
    }

    async function listProducts(actor) {
        rules.requireActor(actor);
        return products.list();
    }

    async function getProduct(input, actor) {
        rules.requireActor(actor);

        const product = await products.findById(productId(input));

        if (!product) {
            rules.fail("NOT_FOUND", "Product not found");
        }

        return product;
    }

    async function createProduct(input, actor) {
        rules.requireAdmin(actor);

        return products.create(
            rules.productInput(input, true)
        );
    }

    async function updateProduct(input, actor) {
        rules.requireAdmin(actor);

        const pid = productId(input);
        const patch = rules.productInput(input, false);
        const product = await products.update(pid, patch);

        if (!product) {
            rules.fail("NOT_FOUND", "Product not found");
        }

        return product;
    }

    async function deleteProduct(input, actor) {
        rules.requireAdmin(actor);

        const pid = productId(input);
        const removed = await products.remove(pid);

        if (!removed) {
            rules.fail("NOT_FOUND", "Product not found");
        }

        return {
            message: "Product deleted successfully",
            pid
        };
    }

    return {
        listProducts,
        getProduct,
        createProduct,
        updateProduct,
        deleteProduct
    };
}

module.exports = { createProductUseCases };