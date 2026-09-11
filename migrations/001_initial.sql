CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE account (
    id UUID PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE session (
    token_hash TEXT PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES account(id),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX session_account ON session(account_id);

CREATE TABLE listing (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES account(id),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
    address TEXT NOT NULL CHECK (length(address) BETWEEN 3 AND 250),
    location geography(Point, 4326) NOT NULL,
    hourly_price_cents INTEGER NOT NULL CHECK (hourly_price_cents BETWEEN 1 AND 100000),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX listing_location ON listing USING gist(location) WHERE active;
CREATE INDEX listing_owner ON listing(owner_id, id);

CREATE TABLE booking (
    id UUID PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES account(id),
    listing_id UUID NOT NULL REFERENCES listing(id),
    request_id UUID NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    total_price_cents INTEGER NOT NULL CHECK (total_price_cents > 0),
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    cancelled_at TIMESTAMPTZ,
    UNIQUE(customer_id, request_id),
    CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '30 days'),
    CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
    CONSTRAINT no_overlapping_bookings EXCLUDE USING gist (
        listing_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
    ) WHERE (status = 'confirmed')
);
CREATE INDEX booking_customer ON booking(customer_id, created_at DESC, id);
