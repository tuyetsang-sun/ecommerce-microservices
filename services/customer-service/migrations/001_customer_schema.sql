CREATE TABLE public.memberships (
  mid INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mname VARCHAR(50) NOT NULL,
  score INTEGER NOT NULL,

  CONSTRAINT memberships_mid_positive CHECK (mid > 0),

  CONSTRAINT memberships_name_valid CHECK (
    mname = BTRIM(mname) AND CHAR_LENGTH(mname) > 0
  ),

  CONSTRAINT memberships_score_nonnegative CHECK (score >= 0)
);

CREATE UNIQUE INDEX memberships_name_unique
  ON public.memberships (LOWER(mname));

INSERT INTO public.memberships (mname, score)
VALUES ('normal', 10);

CREATE TABLE public.customers (
  uid INTEGER PRIMARY KEY,
  fullname VARCHAR(100),
  mid INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT customers_uid_positive CHECK (uid > 0),

  CONSTRAINT customers_fullname_valid CHECK (
    fullname IS NULL OR (
      fullname = BTRIM(fullname) AND CHAR_LENGTH(fullname) > 0
    )
  ),

  CONSTRAINT customers_membership_fk FOREIGN KEY (mid)
    REFERENCES public.memberships(mid)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX customers_mid_index ON public.customers(mid);