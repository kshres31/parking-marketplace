# Stripe sandbox acceptance

Only stripe_test is implemented; live keys are refused. No Stripe account was available for
an authenticated sandbox run. Tests verify signed events and simulated provider outcomes
against a real database. They do not prove an external payment completed.

## State and transactions

Held reservations block their interval for 35 minutes. A signed paid event confirms an active
hold only when amount, currency and provider references match. Expiry/cancellation releases
the stored interval. A late payment queues a full refund; it never reclaims the space.

Cancellation and confirmation lock the booking. Event IDs are stored atomically with the
state change. Repeated paid events cannot undo refunds or create duplicate refund jobs.
Checkout uses the stored price and a booking-derived idempotency key. Provider calls happen
outside database transactions. Webhook HMAC verification uses the raw body and a five-minute
timestamp tolerance. A success redirect merely opens the booking view to retrieve its status.

## Account-dependent acceptance steps

1. Create a Stripe sandbox. Put its test secret and endpoint signing secret in environment
   settings, choose PAYMENTS_MODE=stripe_test and the exact PUBLIC_URL, then restart app/worker.
2. Configure `/payments/webhook` for checkout.session.completed and checkout.session.expired,
   or use Stripe CLI forwarding locally. Match endpoint/account API versions and retest upgrades.
3. Create host/customer accounts and a fictional listing. Reserve at least 40 minutes ahead
   and open checkout immediately. Minimum payment is $0.50.
4. Use Stripe's documented test card (4242 4242 4242 4242, future expiry, test CVC). Verify
   confirmation only follows the signed paid event. Resend it and verify one transition.
5. Cancel the paid future booking. Verify refund_pending followed by refunded, and one full
   test refund in Stripe. Simulate provider interruption and confirm the durable job retries.
6. Exercise declines, abandoned checkout, duplicate/delayed events and an expired hold with
   a late payment. The original interval must remain released while compensation proceeds.
7. Record source revision, event IDs and redacted outcomes before claiming sandbox acceptance.
   Never commit secret keys or card data.

References: [Checkout](https://docs.stripe.com/api/checkout/sessions/create),
[signatures](https://docs.stripe.com/webhooks/signature),
[refunds](https://docs.stripe.com/api/refunds/create),
[idempotency](https://docs.stripe.com/api/idempotent_requests).

Marketplace payouts, Connect onboarding, disputes, taxes and live charging are outside this
sandbox implementation. No payment reliability or host payout metrics are claimed.
