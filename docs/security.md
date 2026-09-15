# Security scope

Implemented: Argon2id password hashes; random 256-bit bearer tokens stored only as SHA-256
digests; server-side session expiry and revocation; parameterized SQL; strict request models;
ownership checks; bounded search/report queries; non-cacheable API responses; validation
responses that omit submitted values such as passwords. Database constraints protect interval
and quantity invariants even when competing API instances race.

Browser sessions use HttpOnly/SameSite=Lax cookies with configurable Secure, and mutating
browser requests require the exact configured Origin. API bodies are capped at 64 KiB.
PostgreSQL shares login/registration attempt counts across processes. The maintenance worker
removes expired sessions and counters. Runtime database grants exclude DDL and migration history.
Stripe calls accept test keys only; signed webhooks enforce timestamp, amount and reference
checks, with durable event deduplication and refund jobs. The browser never handles card data.

This is a local/staging application. Before public deployment, complete:

- Broader abuse controls for listings, bookings and account enumeration.
- Account verification, password recovery and session/device management.
- HTTPS termination, trusted-proxy configuration and managed secrets in the chosen host.
- Structured redacted logs, alerting, ongoing dependency scanning and a backup/restore drill.
- Retention policy for reservation/payment records; do not remove keys while retries remain valid.

The frontend production-dependency audit reported zero known advisories on September 13, 2026.
That narrow dependency check is not a code security assessment or a guarantee against vulnerabilities.

No wildcard credentialed CORS policy is enabled. The Compose services bind only to loopback.
No real customer data or payment details are required for demonstrations. Public exposure is
not yet configured. A security document is not a penetration-test result.
