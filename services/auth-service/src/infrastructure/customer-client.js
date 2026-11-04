const { grpc, ecommerce } = require("./proto");

function createCustomerClient(address, secret) {
    if (!/^[a-f0-9]{64}$/.test(secret || "")) {
        throw new Error(
            "CUSTOMER_PROVISIONING_SECRET must contain 64 lowercase hex characters"
        );
    }

    const client = new ecommerce.customer.CustomerService(
        address,
        grpc.credentials.createInsecure()
    );

    function ensureCustomer(input) {
        const metadata = new grpc.Metadata();
        metadata.set("x-provisioning-key", secret);

        return new Promise((resolve, reject) => {
            client.ensureCustomer({
                    uid: input.uid,
                    fullname: input.fullname || ""
                },
                metadata, {
                    deadline: new Date(Date.now() + 3000)
                },
                (error, customer) => {
                    if (error) return reject(error);

                    if (!customer ||
                        customer.uid !== input.uid ||
                        !Number.isInteger(customer.mid) ||
                        customer.mid < 1
                    ) {
                        return reject(
                            Object.assign(
                                new Error("Invalid Customer response"), { code: "INVALID_CUSTOMER_RESPONSE" }
                            )
                        );
                    }

                    resolve(customer);
                }
            );
        });
    }

    return {
        ensureCustomer,
        close: () => client.close()
    };
}

module.exports = { createCustomerClient };