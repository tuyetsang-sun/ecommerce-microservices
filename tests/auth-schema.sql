BEGIN;

DO $test$
DECLARE
    test_name TEXT :=
        'check_' || replace(gen_random_uuid()::text, '-', '');

    test_email TEXT := test_name || '@example.test';
    inserted_uid INTEGER;
    assigned_role TEXT;
BEGIN
    -- Du lieu thu kiem tra schema; se duoc ROLLBACK.
    -- SCHEMA_TEST_ONLY khong phai hash dung de dang nhap.

    INSERT INTO public.users (username, password_hash, email)
    VALUES (test_name, 'SCHEMA_TEST_ONLY', test_email)
    RETURNING uid INTO inserted_uid;

    SELECT r.rolename
    INTO assigned_role
    FROM public.users AS u
    JOIN public.roles AS r ON r.roleid = u.roleid
    WHERE u.uid = inserted_uid;

    IF assigned_role IS DISTINCT FROM 'normal' THEN
        RAISE EXCEPTION 'FAIL: default role must be normal';
    END IF;

    RAISE NOTICE 'OK: default role is normal';

    BEGIN
        INSERT INTO public.users (username, password_hash)
        VALUES (upper(test_name), 'SCHEMA_TEST_ONLY');

        RAISE EXCEPTION 'FAIL: duplicate username was accepted';
    EXCEPTION
        WHEN unique_violation THEN
            RAISE NOTICE 'OK: duplicate username rejected';
    END;

    BEGIN
        INSERT INTO public.users (username, password_hash, email)
        VALUES (
            test_name || '_email',
            'SCHEMA_TEST_ONLY',
            upper(test_email)
        );

        RAISE EXCEPTION 'FAIL: duplicate email was accepted';
    EXCEPTION
        WHEN unique_violation THEN
            RAISE NOTICE 'OK: duplicate email rejected';
    END;

    BEGIN
        INSERT INTO public.users (username, password_hash, roleid)
        VALUES (test_name || '_role', 'SCHEMA_TEST_ONLY', 999999);

        RAISE EXCEPTION 'FAIL: unknown role was accepted';
    EXCEPTION
        WHEN foreign_key_violation THEN
            RAISE NOTICE 'OK: unknown role rejected';
    END;

    BEGIN
        INSERT INTO public.users (username)
        VALUES (test_name || '_nohash');

        RAISE EXCEPTION 'FAIL: missing password hash was accepted';
    EXCEPTION
        WHEN not_null_violation THEN
            RAISE NOTICE 'OK: missing password hash rejected';
    END;

    RAISE NOTICE 'AUTH SCHEMA CHECK PASSED';
END;
$test$;

ROLLBACK;
