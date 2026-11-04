BEGIN;

DO $$
DECLARE
  test_uid INTEGER;
  actual_mid INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE mid = 1 AND mname = 'normal' AND score = 10
  ) THEN
    RAISE EXCEPTION 'FAIL: default membership seed';
  END IF;

  RAISE NOTICE 'OK: default membership is normal, score 10';

  SELECT candidate INTO test_uid
  FROM generate_series(2147483600, 2147483646) AS t(candidate)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.customers WHERE uid = candidate
  )
  LIMIT 1;

  IF test_uid IS NULL THEN
    RAISE EXCEPTION 'FAIL: no unused test uid';
  END IF;

  INSERT INTO public.customers(uid)
  VALUES (test_uid)
  RETURNING mid INTO actual_mid;

  IF actual_mid <> 1 THEN
    RAISE EXCEPTION 'FAIL: default customer membership';
  END IF;

  RAISE NOTICE 'OK: customer defaults to mid 1; fullname may be null';

  UPDATE public.customers
  SET fullname = 'Schema Test'
  WHERE uid = test_uid;

  IF NOT EXISTS (
    SELECT 1 FROM public.customers
    WHERE uid = test_uid AND fullname = 'Schema Test'
  ) THEN
    RAISE EXCEPTION 'FAIL: fullname update';
  END IF;

  RAISE NOTICE 'OK: fullname can be updated';

  BEGIN
    INSERT INTO public.customers(uid) VALUES (test_uid);
    RAISE EXCEPTION 'FAIL: duplicate uid accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK: duplicate uid rejected';
  END;

  BEGIN
    UPDATE public.customers SET mid = 0 WHERE uid = test_uid;
    RAISE EXCEPTION 'FAIL: unknown membership accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'OK: unknown membership rejected';
  END;

  BEGIN
    UPDATE public.customers SET mid = NULL WHERE uid = test_uid;
    RAISE EXCEPTION 'FAIL: null membership accepted';
  EXCEPTION WHEN not_null_violation THEN
    RAISE NOTICE 'OK: null membership rejected';
  END;

  BEGIN
    UPDATE public.customers
    SET fullname = '   '
    WHERE uid = test_uid;

    RAISE EXCEPTION 'FAIL: blank fullname accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK: blank fullname rejected';
  END;

  BEGIN
    UPDATE public.customers
    SET fullname = REPEAT('x', 101)
    WHERE uid = test_uid;

    RAISE EXCEPTION 'FAIL: fullname longer than 100 accepted';
  EXCEPTION WHEN string_data_right_truncation THEN
    RAISE NOTICE 'OK: fullname longer than 100 rejected';
  END;

  BEGIN
    INSERT INTO public.memberships(mname, score)
    VALUES ('NORMAL', 10);

    RAISE EXCEPTION 'FAIL: duplicate membership name accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK: case-insensitive duplicate membership name rejected';
  END;

  BEGIN
    UPDATE public.memberships SET score = -1 WHERE mid = 1;
    RAISE EXCEPTION 'FAIL: negative score accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK: negative score rejected';
  END;

  BEGIN
    UPDATE public.memberships SET mname = ' ' WHERE mid = 1;
    RAISE EXCEPTION 'FAIL: blank membership name accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK: blank membership name rejected';
  END;

  BEGIN
    DELETE FROM public.memberships WHERE mid = 1;
    RAISE EXCEPTION 'FAIL: referenced membership deleted';
  EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN
    RAISE NOTICE 'OK: referenced membership cannot be deleted';
  END;

  RAISE NOTICE 'CUSTOMER SCHEMA CHECK PASSED';
END $$;

ROLLBACK;