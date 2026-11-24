# Project status

Last updated: 2026-11-24 (milestone 3). Keep this file current at the end of every working session.

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

Milestones 1 and 2 merged to `main` as PRs #2 and #3.

### Milestone 3 (branch `feat/map-search-pagination`)

- Clicking the map searches around that point ("Map pin" in the destination picker).
- Customer bookings load 20 at a time with "Load more" (deduplicated if offsets shift).
- Owners switch reservations between upcoming and past. Shortcut: this filters the newest 100
  rows client-side; add a server-side filter if owners need deeper history.
- 34 Vitest tests and 10 Playwright tests pass locally.

## Next milestones

1. Address search (geocoding) as an alternative to clicking the map.
2. Operations: deployed acceptance pass, restore drill and alerting (see README).
3. Live Stripe test-mode run once a Stripe test account is connected.

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
