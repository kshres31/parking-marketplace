# Parkside — Parking Marketplace

A Next.js/TypeScript map interface backed by FastAPI and PostgreSQL/PostGIS. Find fictional
parking, register, reserve and cancel bookings, or list and pause your own spaces.

Two explicit modes: **demo** makes unpaid reservations; **stripe_test** uses Stripe-hosted
card checkout, expiring holds, signed webhooks and retryable refunds. Live payments are
disabled. This portfolio app does not grant real parking rights.

## Run the complete demo

Install and start Docker Desktop with Compose, then run:

```sh
docker compose --profile demo up --build
```

Open **http://localhost:8000** and register your own account. The demo profile inserts six
fictional Chicago spaces once, without resetting existing records. There is no shared demo
password. The map uses OpenStreetMap tiles with attribution; the list works if tiles cannot load.

The Docker build exports Next.js and serves it from the API's origin. Browser sessions use
HttpOnly cookies; JavaScript never receives the token. Non-browser clients can still use
bearer tokens. Interactive API documentation is at `/docs`.

Compose runs PostGIS, a migration/provisioning job, the app, and a maintenance worker.
App/worker use a restricted database role; migration ownership stays separate. Services
bind to loopback. Local passwords in `.env.example` are demonstration values. Records persist
in the `parking_data` volume; do not remove it to upgrade.

## Verification and development

```sh
python -m pip install -r requirements.lock
ruff check .
pytest -v
cd frontend
npm ci
npm run build
npm run test:e2e
```

Integration/browser tests require `TEST_DATABASE_URL` with permission to create disposable
PostGIS databases and the test runtime role. They never reset the supplied database.
Unit-only runs explicitly skip integration cases. Browser tests use the built UI and real
API/database on desktop/mobile viewports. CI also records a spatial-query benchmark.

For manual development, set `DATABASE_URL`, apply `python -m parking.migrate`, build the
frontend, and start `uvicorn parking.app:app` plus `python -m parking.worker`. Rebuild after
frontend edits; restart the API if the export did not exist at startup. Python does not
automatically read `.env` outside Compose.

## Behavior

- Timezone-aware intervals, elapsed-time pricing in integer USD cents, maximum 720 hours.
- Database exclusion protects held/confirmed intervals; adjacent bookings are valid.
- Customer-scoped UUID retry keys return the existing booking, including cancellations.
- Owner-only listing/reservation views and customer-only booking reads/cancellation.
- Twelve-hour revocable sessions, browser origin checks and shared sign-in rate limits.
- Stripe test holds last 35 minutes; start checkout in the first four minutes. Minimum
  payment $0.50; parking must start at least 40 minutes away.
- A signed paid webhook with matching amount/currency confirms payment. Browser redirects
  cannot confirm bookings. Late payments queue a refund instead of reclaiming a space.
- Paid cancellation releases the interval and queues a full test refund.
- Listings operate around the clock until paused; pausing preserves existing reservations.

## Deployment and evidence

See [deployment](docs/deployment.md), [payment acceptance](docs/payments.md),
[architecture](docs/architecture.md), [security](docs/security.md), and the
[evidence ledger](evidence/README.md).

No hosting or Stripe account was available, so there is no live deployment or authenticated
sandbox result to claim. Automated payment tests use signed fixtures and simulated provider
responses against a real database. Account recovery, operational alerts, a restore drill,
and a deployed acceptance pass remain before public use. Earlier test/benchmark results
apply to their recorded source revisions; new tests are not counted as passing until CI finishes.
