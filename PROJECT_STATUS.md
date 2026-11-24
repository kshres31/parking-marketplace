# Project status

Last updated: 2026-11-24. Keep this file current at the end of every working session.

## Where things stand

Working end to end with Docker Compose: PostGIS radius search, transaction-safe reservations
(exclusion constraint plus idempotency keys), Stripe test-mode checkout with signed, idempotent
webhooks and a refund worker, HttpOnly cookie sessions, and a Next.js map UI.

### Milestone 1 (branch `feat/roles-listing-details`)

- Customer and owner roles, enforced by FastAPI dependencies on every endpoint (migration 004
  promotes existing hosts to `owner`).
- Listing descriptions, features, partial updates (`PATCH`), images (upload, serve, delete),
  public listing detail, and delete-or-archive that keeps booking history.
- Search filters: `max_price_cents`, `features`, `sort=distance|price`.
- New tests in `tests/test_listings_and_roles.py`: role boundaries, migration backfill, update
  validation, filters, deletion outcomes, a delete-versus-reserve race, image type and size
  checks, and concurrent uploads against the six-image limit. Removing the listing row lock
  makes the two concurrency tests fail, so they exercise the lock.
- UI: registration asks for a role; navigation and the reserve button follow it.

Verified locally against PostgreSQL 16 + PostGIS 3: 43 pytest tests and 4 Playwright browser
tests pass; `ruff check` and `ruff format --check` are clean.

### Milestone 2 (branch `feat/frontend-components`, stacked on milestone 1)

- `page.tsx` went from 937 lines to a ~550-line container. Views and dialogs live in
  `frontend/app/components/`; pure logic (period validation, query building, listing form
  parsing, image checks, money) lives in `frontend/app/lib/`.
- UI for listing descriptions, features, photo upload/gallery/removal, editing, delete or
  archive, and the max-price, feature and sort search filters.
- 32 Vitest + Testing Library tests (`frontend/unit/`), run in CI with `tsc --noEmit`.
- Two new Playwright journeys (feature/price filtering with listing details; owner photo upload,
  edit and delete). 8/8 browser tests pass on desktop and mobile locally.

## Next milestones

1. Booking UX: customer booking pagination in the UI and an owner filter for upcoming vs past.
2. Search: let customers pick a point on the map (or geocode an address) instead of three
   fixed cities.
3. Operations: deployed acceptance pass, restore drill and alerting (see README).

## Decisions

- Redis is not used. Sessions, rate limits and booking exclusivity need PostgreSQL's
  transactions; search depends on live availability, so caching it adds invalidation risk with
  no measured need. Revisit if a load test shows search or rate limiting is the bottleneck.
- Images are stored in PostgreSQL to keep the demo to one dependency. Swap for object storage
  (S3-compatible) before real traffic.
- One role per account. A person who wants to both park and host uses two accounts.

## How to resume

```sh
# PostGIS: docker compose up db   (or any PostgreSQL 16 with postgis + btree_gist)
export TEST_DATABASE_URL=postgresql://USER:PASS@localhost:5432/ADMIN_DB
pip install -r requirements.lock && ruff check . && pytest -v
cd frontend && npm ci && npm run build && npm run test:e2e
```
