# Security scope

Implemented: Argon2id password hashes; random 256-bit bearer tokens stored only as SHA-256
digests; server-side session expiry and revocation; parameterized SQL; strict request models;
ownership checks; bounded search/report queries; non-cacheable API responses; validation
responses that omit submitted values such as passwords. Database constraints protect interval
and quantity invariants even when competing API instances race.

This is a local/staging prototype. Before public deployment, add:

- Shared login/registration rate limits and abuse controls.
- Account verification, password recovery and session/device management.
- HTTPS termination, an explicit origin policy, request/body limits and secret management.
- A browser session design that avoids exposing bearer tokens to persistent browser storage.
- Least-privilege application and migration database roles.
- Structured redacted logs, alerting, dependency scanning and backup/restore verification.
- Retention cleanup for expired sessions and reservation idempotency records.

No wildcard credentialed CORS policy is enabled. The Compose services bind only to loopback.
No real customer data or payment details are required for demonstrations. Public exposure is
not part of this API milestone. A security document is not a penetration-test result.
