# Deployment and operation

The Docker image serves the Next.js export and FastAPI. It requires PostgreSQL 16 with
PostGIS 3.5/btree_gist and a separate `python -m parking.worker` process. Sites can host
frontend assets but cannot run this Python/TCP backend. A frontend-only publication would
not deliver a working marketplace. Hosting credentials were not available for deployment.

## Configure

| Variable | Value |
|---|---|
| DATABASE_URL | Runtime-role URI for app/worker; database-owner URI only for migrations |
| PUBLIC_URL | Exact browser origin, e.g. https://parking.example.com, without a path |
| COOKIE_SECURE | 1 for HTTPS; 0 for loopback development |
| PAYMENTS_MODE | demo or stripe_test |
| STRIPE_SECRET_KEY | Sandbox sk_test_ secret, kept in the host's secret manager |
| STRIPE_WEBHOOK_SECRET | Endpoint signing secret |
| APP_DATABASE_PASSWORD | Runtime password for provisioning |
| AUTH_RATE_LIMIT | Login/registration attempts per client IP per ten minutes; default 30 |

Use the exact configured origin: localhost and 127.0.0.1 differ. URL-encode special characters
in database URI passwords. Compose's interpolation is intended for its local alphanumeric
and underscore password defaults.

## Release

1. Build the Dockerfile. Create a PostgreSQL database with both extensions available.
2. As database owner, run `python -m parking.migrate`, then `python -m scripts.provision_runtime`
   with APP_DATABASE_PASSWORD. The database must permit creation of the fixed runtime role;
   otherwise an administrator must apply the same grants.
3. Start app/worker using the restricted-role URL. Neither applies migrations.
4. Terminate HTTPS at the host, set PUBLIC_URL and COOKIE_SECURE=1, and map ingress to port
   8000. `/health` checks database connectivity. Keep PostgreSQL off the public network.
5. Seed once with `python -m scripts.seed_demo` only for an explicit demo deployment.
6. Complete the browser and sandbox acceptance checks before sharing the service.

Configure trusted proxy addresses explicitly. Do not trust arbitrary forwarded client
headers: the sign-in limit depends on the resolved client IP. The image runs as a non-root user.

## Upgrade and recovery

Back up before applying migrations. Run upgrades as the migration owner and reapply runtime
grants for new tables. Checksummed migrations require a new numbered file for changes.
Never reset a database to fix a checksum mismatch. Example backup from a POSIX shell:

```sh
docker compose exec -T db pg_dump -U parking -d parking -Fc > parking-backup.dump
```

Restore into a new empty database as its owner with `pg_restore --no-owner`. Check row counts
and exclusion constraints before switching traffic. These are instructions; no successful
backup/restore drill has yet been recorded.

Monitor health, API errors, the worker process, overdue held bookings, and refund_job rows
without completed_at, especially attempts > 5 or last_error set. The worker checks holds and
sessions every five seconds and retries provider failures every minute. Failed/refused refunds
need operator attention; only a provider-confirmed success is marked refunded. Reconcile
unknown outcomes with Stripe before manual replay beyond its idempotency-key retention window.
Automated alert delivery and capacity planning remain operational work.
