# Evidence ledger

Features and tests exist in source; execution results must be recorded separately.

The full integration suite requires PostgreSQL with PostGIS. Its contention helper holds a
listing lock on a separate connection and observes every competing API request waiting in
`pg_stat_activity` before releasing it. It asserts HTTP outcomes and final database row counts.
Expected outcomes are one accepted reservation and seven conflicts for eight customers, and
one new reservation plus one replay for two identical requests. These are test assertions,
not measured results until a linked run passes.

Other tests cover Argon2/token storage, expiry/logout, geographic filtering, adjacent intervals,
owner/customer access boundaries, cancellation, failed insertion/retry, timezone validation and
integer-cent rounding. Unit tests alone do not verify database behavior.

Run `python -m scripts.benchmark_search` with `TEST_DATABASE_URL` to create a separate
disposable database, seed a deterministic 10,000-location grid, warm up 20 times and collect
100 SQL round-trip samples plus an `EXPLAIN (ANALYZE, BUFFERS)` plan. GitHub Actions saves
the raw samples, plan, source revision, server versions and workload in its `parking-verification`
artifact for 30 days. The supplied database is never reset. The synthetic dataset has no bookings.
The benchmark measures one SQL radius query on one connection, not the complete availability
endpoint, HTTP traffic, multiple customers, or cold-cache behavior. Inspect the actual query plan
before claiming index use. No load benchmark has been recorded. Do not claim latency reductions,
throughput, payment reliability, live customers, deployed service availability, or production readiness.
