-- Separate customer and parking-owner accounts. Existing accounts that already host
-- spaces become owners; everyone else stays a customer.
ALTER TABLE account ADD COLUMN role TEXT NOT NULL DEFAULT 'customer'
    CHECK (role IN ('customer', 'owner'));
UPDATE account SET role = 'owner' WHERE id IN (SELECT owner_id FROM listing);

-- Richer listings. Features are a closed vocabulary so search filters stay meaningful.
ALTER TABLE listing ADD COLUMN description TEXT NOT NULL DEFAULT ''
    CHECK (length(description) <= 2000);
ALTER TABLE listing ADD COLUMN features TEXT[] NOT NULL DEFAULT '{}'
    CHECK (features <@ ARRAY['covered', 'ev_charging', 'security', 'accessible', 'oversize']::TEXT[]);
ALTER TABLE listing ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- A listing with booking history is archived rather than removed, so customers and owners
-- keep their records. Archived listings are never bookable.
ALTER TABLE listing ADD COLUMN archived_at TIMESTAMPTZ;
ALTER TABLE listing ADD CONSTRAINT archived_is_inactive CHECK (archived_at IS NULL OR NOT active);
CREATE INDEX listing_features ON listing USING gin(features) WHERE active;

-- Images live in PostgreSQL to keep the demo self-contained; production would use object storage.
CREATE TABLE listing_image (
    id UUID PRIMARY KEY,
    listing_id UUID NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
    content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    data BYTEA NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 2097152),
    sha256 TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX listing_image_listing ON listing_image(listing_id, created_at, id);
