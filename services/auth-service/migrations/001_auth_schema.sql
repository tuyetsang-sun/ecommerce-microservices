CREATE TABLE public.roles (
    roleid INTEGER PRIMARY KEY,
    rolename VARCHAR(50) NOT NULL UNIQUE
);

INSERT INTO public.roles (roleid, rolename)
VALUES
    (1, 'normal'),
    (2, 'admin');

CREATE TABLE public.users (
    uid INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    username VARCHAR(50) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,

    email VARCHAR(254),
    phone VARCHAR(20),

    roleid INTEGER NOT NULL DEFAULT 1,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT users_username_valid
        CHECK (
            char_length(btrim(username)) > 0
            AND username = btrim(username)
        ),

    CONSTRAINT users_password_hash_not_empty
        CHECK (char_length(password_hash) > 0),

    CONSTRAINT users_email_valid
        CHECK (
            email IS NULL
            OR (
                char_length(btrim(email)) > 0
                AND email = btrim(email)
            )
        ),

    CONSTRAINT users_role_fk
        FOREIGN KEY (roleid)
        REFERENCES public.roles(roleid)
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX users_username_unique
    ON public.users (lower(username));

CREATE UNIQUE INDEX users_email_unique
    ON public.users (lower(email))
    WHERE email IS NOT NULL;