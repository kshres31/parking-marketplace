ALTER TABLE booking DROP CONSTRAINT booking_status_check;
ALTER TABLE booking ADD CONSTRAINT booking_status_check
    CHECK (status IN ('held', 'confirmed', 'cancelled'));
ALTER TABLE booking ADD COLUMN hold_expires_at TIMESTAMPTZ;
ALTER TABLE booking ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'demo'
    CHECK (payment_status IN ('demo', 'unpaid', 'paid', 'refund_pending', 'refunded'));
ALTER TABLE booking ADD COLUMN checkout_id TEXT UNIQUE;
ALTER TABLE booking ADD COLUMN checkout_url TEXT;
ALTER TABLE booking ADD COLUMN payment_intent TEXT UNIQUE;
ALTER TABLE booking ADD CONSTRAINT held_requires_expiry CHECK (status <> 'held' OR hold_expires_at IS NOT NULL);
ALTER TABLE booking DROP CONSTRAINT no_overlapping_bookings;
ALTER TABLE booking ADD CONSTRAINT no_overlapping_bookings EXCLUDE USING gist (
    listing_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (status IN ('held', 'confirmed'));
CREATE INDEX booking_expiring ON booking(hold_expires_at) WHERE status = 'held';

CREATE TABLE payment_event (
    id TEXT PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE refund_job (
    booking_id UUID PRIMARY KEY REFERENCES booking(id),
    payment_intent TEXT NOT NULL UNIQUE,
    refund_id TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    last_error TEXT
);
CREATE TABLE auth_limit (
    bucket TEXT PRIMARY KEY,
    window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INTEGER NOT NULL DEFAULT 1
);
