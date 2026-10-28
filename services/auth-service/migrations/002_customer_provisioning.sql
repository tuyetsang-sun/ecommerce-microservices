CREATE TABLE public.customer_provisioning (
  uid INTEGER PRIMARY KEY REFERENCES public.users(uid) ON DELETE CASCADE,
  fullname VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX customer_provisioning_pending
ON public.customer_provisioning (next_attempt_at, uid)
WHERE processed_at IS NULL;