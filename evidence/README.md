# Evidence ledger

## Verified run: September 13, 2026

[GitHub Actions run 34773240058](https://github.com/kshres31/parking-marketplace/actions/runs/34773240058)
passed **20 tests, zero failures, zero errors, zero skips**, plus Ruff and the SQL benchmark.
Source commit: `5bbb7db371c20020c9bae05a684eaf8eb37eff3f`.
Environment: Python 3.12.14, PostgreSQL 16.9, PostGIS 3.5.2 on a two-CPU Linux runner.

The [saved test report](runs/34773240058/test-results.xml) and
[raw benchmark results](runs/34773240058/search.json) are copied from the CI artifact.
The downloaded ZIP's SHA-256 matched GitHub's recorded digest:
`cdcfb3c2ab202d6aff0e88c3b4e2c4823e4fa86caaba402ce84986b6f66e9d8f`.
GitHub tested merge checkout `22d78402b433fd920611778ffcf2dd34ba751e53` against the
README-only base; the raw result records both checkout and source revisions.

The synthetic 10,000-listing SQL query returned 85 locations in a 1 km radius. For 100
samples after 20 warmups on one connection, p50 was **0.532 ms**, p95 **0.562 ms**, and
p99 **0.602 ms**, with zero query errors. The saved plan used a bitmap index scan on
`listing_location`, followed by a heap filter and sort. These are measurements from one
warm synthetic SQL workload, not HTTP latency, full availability-search performance,
production capacity, or an improvement over a measured baseline.

## Coverage and reproduction

The full integration suite requires PostgreSQL with PostGIS. Its contention helper holds a
listing lock on a separate connection and observes every competing API request waiting in
`pg_stat_activity` before releasing it. It asserts HTTP outcomes and final database row counts.
Expected outcomes are one accepted reservation and seven conflicts for eight customers, and
one new reservation plus one replay for two identical requests. Both assertions passed in
the linked run; this is contention correctness evidence, not a throughput benchmark.

Other tests cover Argon2/token storage, expiry/logout, geographic filtering, adjacent intervals,
owner/customer access boundaries, cancellation, failed insertion/retry, timezone validation and
integer-cent rounding, daylight-saving elapsed duration and changed migration rejection.
Unit tests alone do not verify database behavior.

Run `python -m scripts.benchmark_search` with `TEST_DATABASE_URL` to create a separate
disposable database, seed a deterministic 10,000-location grid, warm up 20 times and collect
100 SQL round-trip samples plus an `EXPLAIN (ANALYZE, BUFFERS)` plan. GitHub Actions saves
the raw samples, plan, source revision, server versions and workload in its `parking-verification`
artifact for 30 days. The supplied database is never reset. The synthetic dataset has no bookings.
The benchmark measures one SQL radius query on one connection, not the complete availability
endpoint, HTTP traffic, multiple customers, or cold-cache behavior. Inspect the actual query plan
before claiming index use. No load benchmark has been recorded. Do not claim latency reductions,
throughput, payment reliability, live customers, deployed service availability, or production readiness.
