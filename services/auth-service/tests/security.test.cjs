const test = require("node:test");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const jwt = require("jsonwebtoken");

const {
    hashPassword,
    verifyPassword
} = require("../src/infrastructure/security/password");

const {
    createTokenService,
    JWT_ISSUER,
    JWT_AUDIENCE
} = require("../src/infrastructure/security/tokens");

const secret = randomBytes(32).toString("hex");
const tokens = createTokenService({ secret });
const user = { uid: 7, username: "sangtuyet01", role: "normal" };

function makeTestToken(options = {}, claims = {}) {
    return jwt.sign({ username: user.username, role: user.role, ...claims },
        secret, {
            algorithm: "HS256",
            subject: String(user.uid),
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
            expiresIn: 3600,
            ...options
        }
    );
}

test("Bcrypt uses salt and distinguishes correct/wrong passwords", async() => {
    const password = "P@ss123";
    const first = await hashPassword(password);
    const second = await hashPassword(password);

    assert.notEqual(first, password);
    assert.notEqual(first, second);
    assert.match(first, /^\$2[aby]\$12\$/);
    assert.equal(await verifyPassword(password, first), true);
    assert.equal(await verifyPassword("WrongPassword", first), false);
});

test("Password handling rejects empty input and bcrypt truncation", async() => {
    const boundary = "é".repeat(36);
    const hash = await hashPassword(boundary);

    assert.equal(await verifyPassword(boundary, hash), true);
    assert.equal(await verifyPassword(boundary + "x", hash), false);
    await assert.rejects(hashPassword(""), TypeError);
    await assert.rejects(hashPassword(boundary + "x"), RangeError);
});

test("A valid JWT returns identity and expires after one hour", () => {
    const token = tokens.signAccessToken(user);
    const identity = tokens.verifyAccessToken(token);
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });

    assert.equal(identity.uid, user.uid);
    assert.equal(identity.username, user.username);
    assert.equal(identity.role, "normal");
    assert.equal(identity.expires_at, payload.exp);
    assert.equal(payload.exp - payload.iat, 3600);
});

test("Changing role in the JWT payload invalidates its signature", () => {
    const parts = tokens.signAccessToken(user).split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));

    payload.role = "admin";
    parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");

    assert.throws(
        () => tokens.verifyAccessToken(parts.join(".")), { name: "JsonWebTokenError" }
    );
});

test("An expired JWT is rejected", () => {
    const token = makeTestToken({ expiresIn: -1 });

    assert.throws(
        () => tokens.verifyAccessToken(token), { name: "TokenExpiredError" }
    );
});

test("A JWT cannot be verified with a different secret", () => {
    const other = createTokenService({
        secret: randomBytes(32).toString("hex")
    });

    assert.throws(
        () => other.verifyAccessToken(tokens.signAccessToken(user)), { name: "JsonWebTokenError" }
    );
});

test("Wrong issuer, audience or algorithm is rejected", () => {
    for (const options of[{ issuer: "other-service" }, { audience: "other-application" }, { algorithm: "HS384" }]) {
        assert.throws(
            () => tokens.verifyAccessToken(makeTestToken(options)), { name: "JsonWebTokenError" }
        );
    }
});

test("Missing expiry and invalid identity claims are rejected", () => {
    const noExpiry = jwt.sign({ username: user.username, role: "normal" },
        secret, {
            algorithm: "HS256",
            subject: "7",
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE
        }
    );

    for (const token of[
            noExpiry,
            makeTestToken({ subject: "0" }),
            makeTestToken({}, { role: "superadmin" })
        ]) {
        assert.throws(
            () => tokens.verifyAccessToken(token), { name: "JsonWebTokenError" }
        );
    }
});

test("Token service rejects missing or too-short secrets", () => {
    assert.throws(() => createTokenService(), /JWT secret/);
    assert.throws(() => createTokenService({ secret: "short" }), /JWT secret/);
});