CREATE TABLE public.orders (
  oid INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  uid INTEGER NOT NULL CHECK (uid > 0),
  score INTEGER NOT NULL CHECK (score >= 0),

  discount_rate NUMERIC(5,2) NOT NULL
    CHECK (discount_rate BETWEEN 0 AND 100),

  subtotal NUMERIC(28,2) NOT NULL
    CHECK (subtotal > 0 AND subtotal <> 'NaN'::NUMERIC),

  discount_amount NUMERIC(28,2) NOT NULL,
  total_amount NUMERIC(28,2) NOT NULL,

  idempotency_key VARCHAR(128) NOT NULL,

  request_hash CHAR(64) NOT NULL
    CHECK (request_hash ~ '^[0-9a-f]{64}$'),

  reservation_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT orders_oid_positive CHECK (oid > 0),

  CONSTRAINT orders_idempotency_valid CHECK (
    idempotency_key = BTRIM(idempotency_key)
    AND CHAR_LENGTH(idempotency_key) > 0
  ),

  CONSTRAINT orders_idempotency_unique
    UNIQUE (uid, idempotency_key),

  CONSTRAINT orders_discount_valid CHECK (
    discount_amount BETWEEN 0 AND subtotal
    AND discount_amount = ROUND(subtotal * discount_rate / 100, 2)
  ),

  CONSTRAINT orders_total_valid CHECK (
    total_amount BETWEEN 0 AND subtotal
    AND total_amount = subtotal - discount_amount
  )
);

CREATE INDEX orders_customer_index
  ON public.orders (uid, created_at DESC, oid DESC);

CREATE TABLE public.order_details (
  oid INTEGER NOT NULL
    REFERENCES public.orders(oid) ON DELETE RESTRICT,

  pid INTEGER NOT NULL CHECK (pid > 0),
  qty INTEGER NOT NULL CHECK (qty > 0),

  unit_price NUMERIC(14,2) NOT NULL CHECK (
    unit_price > 0 AND unit_price <> 'NaN'::NUMERIC
  ),

  PRIMARY KEY (oid, pid)
);

CREATE TABLE public.order_outbox (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  oid INTEGER NOT NULL
    REFERENCES public.orders(oid) ON DELETE RESTRICT,

  event_type VARCHAR(50) NOT NULL DEFAULT 'order-created'
    CHECK (event_type = 'order-created'),

  payload JSONB NOT NULL
    CHECK (jsonb_typeof(payload) = 'object'),

  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  last_error VARCHAR(1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (oid, event_type)
);

CREATE INDEX order_outbox_pending_index
  ON public.order_outbox (next_attempt_at, created_at)
  WHERE published_at IS NULL;