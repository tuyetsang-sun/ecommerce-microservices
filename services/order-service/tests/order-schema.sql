BEGIN;

DO $$
DECLARE
  test_oid INTEGER;
  test_key TEXT := 'schema-' || gen_random_uuid()::TEXT;
BEGIN
  INSERT INTO public.orders (
    uid, score, discount_rate,
    subtotal, discount_amount, total_amount,
    idempotency_key, request_hash, reservation_id
  ) VALUES (
    2147483647, 0, 10,
    200, 20, 180,
    test_key, repeat('a', 64), gen_random_uuid()
  ) RETURNING oid INTO test_oid;

  INSERT INTO public.order_details (oid, pid, qty, unit_price)
  VALUES (test_oid, 1, 2, 100);

  INSERT INTO public.order_outbox (oid, payload)
  VALUES (test_oid, jsonb_build_object('oid', test_oid));

  IF NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE oid = test_oid
      AND subtotal = 200
      AND discount_amount = 20
      AND total_amount = 180
  ) THEN
    RAISE EXCEPTION 'Incorrect monetary values';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.order_outbox
    WHERE oid = test_oid
      AND published_at IS NULL
      AND attempts = 0
  ) THEN
    RAISE EXCEPTION 'Incorrect outbox defaults';
  END IF;

  RAISE NOTICE 'OK: order, details and pending event inserted together';

  BEGIN
    INSERT INTO public.orders (
      uid, score, discount_rate,
      subtotal, discount_amount, total_amount,
      idempotency_key, request_hash, reservation_id
    ) VALUES (
      2147483647, 0, 10,
      200, 20, 180,
      test_key, repeat('a', 64), gen_random_uuid()
    );

    RAISE EXCEPTION 'Duplicate idempotency key accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RAISE NOTICE 'OK: duplicate order request rejected';

  BEGIN
    UPDATE public.orders
    SET total_amount = 181
    WHERE oid = test_oid;

    RAISE EXCEPTION 'Incorrect total accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.orders
    SET discount_amount = 21, total_amount = 179
    WHERE oid = test_oid;

    RAISE EXCEPTION 'Incorrect discount accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.orders
    SET discount_rate = 101
    WHERE oid = test_oid;

    RAISE EXCEPTION 'Invalid discount rate accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'OK: invalid money calculations rejected';

  BEGIN
    UPDATE public.order_details
    SET qty = 0
    WHERE oid = test_oid;

    RAISE EXCEPTION 'Zero quantity accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.order_details (oid, pid, qty, unit_price)
    VALUES (test_oid, 1, 1, 100);

    RAISE EXCEPTION 'Duplicate product line accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.order_details (oid, pid, qty, unit_price)
    VALUES (-1, 1, 1, 100);

    RAISE EXCEPTION 'Orphan order detail accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'OK: quantity, detail uniqueness and foreign key checked';

  BEGIN
    INSERT INTO public.order_outbox (oid, payload)
    VALUES (test_oid, jsonb_build_object('oid', test_oid));

    RAISE EXCEPTION 'Duplicate event accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.order_outbox
    SET payload = '[]'::JSONB
    WHERE oid = test_oid;

    RAISE EXCEPTION 'Non-object payload accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'OK: event uniqueness and payload checked';
END $$;

ROLLBACK;