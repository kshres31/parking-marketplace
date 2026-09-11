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

No load benchmark or spatial query plan has been recorded. Do not claim latency reductions,
throughput, payment reliability, live customers, deployed service availability, or production readiness.
