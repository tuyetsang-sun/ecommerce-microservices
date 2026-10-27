const { AuthError } = require("../domain/auth-error");
const { registrationInput, loginInput } = require("../domain/auth-input");

function createAuthUseCases({ users, passwords, tokens, expiresIn }) {
    if (!Number.isInteger(expiresIn) || expiresIn <= 0) {
        throw new TypeError("expiresIn must be a positive integer");
    }

    async function register(input) {
        const data = registrationInput(input);
        const passwordHash = await passwords.hashPassword(data.password);

        const user = await users.createNormalUser({
            username: data.username,
            passwordHash,
            email: data.email,
            phone: data.phone,
            fullname: data.fullname
        });

        return {
            uid: user.uid,
            message: "User registered successfully"
        };
    }

    async function login(input) {
        const data = loginInput(input);
        const user = await users.findByUsername(data.username);

        if (!user ||
            !(await passwords.verifyPassword(data.password, user.passwordHash))
        ) {
            throw new AuthError(
                "UNAUTHENTICATED",
                "Invalid username or password"
            );
        }

        return {
            access_token: tokens.signAccessToken({
                uid: user.uid,
                username: user.username,
                role: user.role
            }),
            token_type: "Bearer",
            expires_in: expiresIn
        };
    }

    async function verifyToken(input) {
        if (!input ||
            typeof input.access_token !== "string" ||
            !input.access_token
        ) {
            throw new AuthError(
                "UNAUTHENTICATED",
                "Invalid or expired access token"
            );
        }

        let identity;

        try {
            identity = tokens.verifyAccessToken(input.access_token);
        } catch {
            throw new AuthError(
                "UNAUTHENTICATED",
                "Invalid or expired access token"
            );
        }

        const user = await users.findIdentityById(identity.uid);

        if (!user ||
            user.username !== identity.username ||
            user.role !== identity.role
        ) {
            throw new AuthError(
                "UNAUTHENTICATED",
                "Invalid or expired access token"
            );
        }

        return identity;
    }

    return { register, login, verifyToken };
}

module.exports = { createAuthUseCases };