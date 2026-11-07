CREATE TABLE public.order_requests (
  reservation_id UUID PRIMARY KEY,
  uid INTEGER NOT NULL CHECK (uid > 0),
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,

  items JSONB NOT NULL
    CHECK (jsonb_typeof(items) = 'array'),

  membership JSONB NOT NULL
    CHECK (jsonb_typeof(membership) = 'object'),

  state VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (
      state IN (
        'PENDING',
        'CONFIRMING',
        'COMPENSATING',
        'DONE',
        'FAILED'
      )
    ),

  failure_code INTEGER,
  failure_message TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (uid, idempotency_key)
);

CREATE INDEX order_requests_pending
ON public.order_requests(next_attempt_at)
WHERE state IN ('PENDING', 'CONFIRMING', 'COMPENSATING');