const test = require("node:test");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");

const { AuthError } = require("../src/domain/auth-error");
const { createAuthUseCases } = require("../src/application/auth-use-cases");
const passwords = require("../src/infrastructure/security/password");

const {
    createTokenService,
    ACCESS_TOKEN_TTL_SECONDS
} = require("../src/infrastructure/security/tokens");

function setup() {
    const rows = [];
    const pendingProfiles = [];
    const createInputs = [];
    let nextUid = 1;

    // Repository trong bộ nhớ, chỉ sử dụng cho unit test.
    const users = {
        async createNormalUser(data) {
            createInputs.push(data);

            const duplicate = rows.some(row =>
                row.username.toLowerCase() === data.username.toLowerCase() ||
                (data.email !== null && row.email === data.email)
            );

            if (duplicate) {
                throw new AuthError(
                    "CONFLICT",
                    "Username or email already exists"
                );
            }

            const row = {
                uid: nextUid++,
                username: data.username,
                passwordHash: data.passwordHash,
                email: data.email,
                phone: data.phone,
                role: "normal"
            };

            rows.push(row);
            pendingProfiles.push({
                uid: row.uid,
                fullname: data.fullname
            });

            return { uid: row.uid };
        },

        async findByUsername(username) {
            return rows.find(
                row => row.username.toLowerCase() === username.toLowerCase()
            ) || null;
        },

        async findIdentityById(uid) {
            return rows.find(row => row.uid === uid) || null;
        }
    };

    const tokens = createTokenService({
        secret: randomBytes(32).toString("hex")
    });

    const auth = createAuthUseCases({
        users,
        passwords,
        tokens,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS
    });

    return { auth, users, rows, pendingProfiles, createInputs };
}

const account = {
    username: "john",
    password: "P@ss123",
    email: "john@example.com",
    fullname: "John Nguyen"
};

test("Register hashes password, limits returned fields and preserves profile intent", async() => {
    const { auth, rows, pendingProfiles, createInputs } = setup();

    const result = await auth.register({
        ...account,
        role: "admin",
        roleid: 2,
        mid: 99
    });

    assert.deepEqual(result, {
        uid: 1,
        message: "User registered successfully"
    });

    assert.equal(rows[0].role, "normal");

    for (const field of["password", "role", "roleid", "mid"]) {
        assert.equal(Object.hasOwn(createInputs[0], field), false);
    }

    assert.equal(Object.hasOwn(rows[0], "password"), false);
    assert.notEqual(rows[0].passwordHash, account.password);

    assert.equal(
        await passwords.verifyPassword(account.password, rows[0].passwordHash),
        true
    );

    assert.deepEqual(pendingProfiles, [
        { uid: 1, fullname: "John Nguyen" }
    ]);
});

test("Duplicate username and email are reported as conflicts", async() => {
    const { auth } = setup();
    await auth.register(account);

    await assert.rejects(
        auth.register({...account, username: "JOHN", email: null }), { code: "CONFLICT" }
    );

    await assert.rejects(
        auth.register({
            ...account,
            username: "other",
            email: "JOHN@EXAMPLE.COM"
        }), { code: "CONFLICT" }
    );
});

test("Invalid registration input does not create an account", async() => {
    const { auth, rows } = setup();

    for (const input of[
            null, [], {...account, password: undefined }, {...account, password: "é".repeat(37) }, {...account, email: "invalid-email" }, {...account, username: "x".repeat(51) }, {...account, fullname: "x".repeat(101) }
        ]) {
        await assert.rejects(
            auth.register(input), { code: "VALIDATION_ERROR" }
        );
    }

    assert.equal(rows.length, 0);
});

test("Login returns a verifiable token and preserves password spaces", async() => {
    const { auth } = setup();

    await auth.register({
        ...account,
        password: " P@ss123 "
    });

    const result = await auth.login({
        username: " JOHN ",
        password: " P@ss123 ",
        role: "admin"
    });

    assert.deepEqual(
        Object.keys(result).sort(), ["access_token", "expires_in", "token_type"]
    );

    assert.equal(result.token_type, "Bearer");
    assert.equal(result.expires_in, 3600);

    const identity = await auth.verifyToken({
        access_token: result.access_token
    });

    assert.equal(identity.uid, 1);
    assert.equal(identity.role, "normal");

    await assert.rejects(
        auth.login(account), { code: "UNAUTHENTICATED" }
    );
});

test("Unknown user and wrong password have the same public error", async() => {
    const { auth } = setup();
    await auth.register(account);

    for (const input of[{ username: "missing", password: account.password }, { username: account.username, password: "wrong" }]) {
        await assert.rejects(auth.login(input), {
            code: "UNAUTHENTICATED",
            message: "Invalid username or password"
        });
    }
});

test("Incomplete login input is a validation error", async() => {
    const { auth } = setup();

    await assert.rejects(
        auth.login({ username: "john" }), { code: "VALIDATION_ERROR" }
    );

    await assert.rejects(
        auth.login({ username: 123, password: "P@ss123" }), { code: "VALIDATION_ERROR" }
    );
});

test("Forged and missing tokens are rejected", async() => {
    const { auth } = setup();
    await auth.register(account);

    const { access_token } = await auth.login(account);
    const parts = access_token.split(".");

    const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf8")
    );

    payload.role = "admin";

    parts[1] = Buffer.from(
        JSON.stringify(payload)
    ).toString("base64url");

    for (const input of[{ access_token: parts.join(".") }, {},
            null
        ]) {
        await assert.rejects(
            auth.verifyToken(input), { code: "UNAUTHENTICATED" }
        );
    }
});

test("Changing a role invalidates the old token and a new login uses the new role", async() => {
    const { auth, rows } = setup();
    await auth.register(account);

    const old = await auth.login(account);

    // Mô phỏng thay đổi role trong database.
    rows[0].role = "admin";

    await assert.rejects(
        auth.verifyToken(old), { code: "UNAUTHENTICATED" }
    );

    const current = await auth.login(account);

    assert.equal(
        (await auth.verifyToken(current)).role,
        "admin"
    );
});

test("Deleting an account invalidates its token", async() => {
    const { auth, rows } = setup();
    await auth.register(account);

    const token = await auth.login(account);
    rows.pop();

    await assert.rejects(
        auth.verifyToken(token), { code: "UNAUTHENTICATED" }
    );
});

test("Repository failures are not misreported as invalid credentials", async() => {
    const { auth, users } = setup();
    await auth.register(account);

    const token = await auth.login(account);
    const failure = new Error("Database unavailable");

    users.findByUsername = async() => {
        throw failure;
    };

    users.findIdentityById = async() => {
        throw failure;
    };

    await assert.rejects(
        auth.login(account),
        error => error === failure
    );

    await assert.rejects(
        auth.verifyToken(token),
        error => error === failure
    );
});