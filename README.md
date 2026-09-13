# Parking Marketplace

An API-first portfolio project for finding and reserving parking. This milestone implements
FastAPI, PostgreSQL/PostGIS, accounts, listings, location search and transaction-safe booking.
The Next.js map interface, payments and public deployment are **not implemented yet**.

## Current workflow

1. Register an account (`POST /auth/register`) or sign in (`POST /auth/login`).
2. Use the returned bearer token to create a listing (`POST /listings`).
3. Search by coordinates and an aware start/end time (`GET /listings`).
4. A different account reserves a listing (`POST /bookings`) with an `Idempotency-Key` UUID.
5. Inspect your reservations (`GET /bookings`) or cancel a future reservation.

API documentation is at `/docs`. There is no map UI in this milestone. A confirmed
reservation is an unpaid allocation of time, not a successful payment or real parking entitlement.
Use fictional demonstration listings only.

## Setup

Requires Docker with Compose, or Python 3.12 and PostgreSQL 16 with PostGIS and btree_gist.

```sh
docker compose up --build
```

The API is bound to `127.0.0.1:8000`; PostgreSQL to `127.0.0.1:55432`.
The Compose password is for local development. Persistent data lives in the `parking_data`
volume. Startup applies checksum-verified migrations without resetting data.

For Python development, create a virtual environment and install the locked dependencies:

```sh
python -m pip install -r requirements.lock
```

Set `DATABASE_URL` using `.env.example` as a guide (the Python application does not automatically
load `.env`), then run `python -m parking.migrate` and `uvicorn parking.app:app --reload`.
Use a separate migration account in a future hosted environment: the local Compose account
has database-owner privileges and is not a production privilege model.

## Verify

```sh
ruff check .
pytest -v
```

Unit tests run without PostgreSQL. Integration tests require `TEST_DATABASE_URL`, pointing
to a PostgreSQL/PostGIS server account with permission to create disposable databases.
Tests create a unique `parking_test_<uuid>` database and remove only that database at teardown;
they never reset the supplied database. Without this setting, integration tests are explicitly
skipped. A passing unit-only run does not establish booking or spatial-query correctness.

GitHub Actions supplies the PostGIS service and runs the full suite. The recorded
[verification run](evidence/README.md) passed 20 tests and includes raw timing samples and
a query plan for a synthetic 10,000-listing radius query. See
[architecture](docs/architecture.md), [security](docs/security.md), and [evidence](evidence/README.md).

## Boundaries

- Usernames are lowercase identifiers, 3–40 characters. Passwords are 12–128 characters.
- Sessions last 12 hours. Logout revokes the current token; no refresh flow exists yet.
- Listing prices are integer USD cents per hour. Charges round up to the next cent.
- Booking intervals are timezone-aware, positive and no longer than 30 days.
- Listings are available at all times unless reserved or deactivated; operating hours are future work.
- Deactivating a listing blocks new bookings and preserves existing reservations.
- Cancelling a future booking releases its interval. Replaying its original request returns its
  current cancelled state; it never silently recreates a booking.

## Next milestones

Add the Next.js map/search/reservation interface, hosted authentication hardening and rate limits,
Stripe test-mode payment holds and verified webhook idempotency, full availability-query
measurements with populated bookings, controlled HTTP load tests, and a deployed staging
environment. Redis will be introduced only for a documented caching or rate-limit need.
The recorded SQL measurement does not establish production traffic capacity or scalability.
