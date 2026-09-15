"""Stripe test-mode Checkout and durable compensation for late payments.

Provider calls happen outside booking transactions. Webhooks never trust the browser
return URL. Refund delivery is at least once, with a stable Stripe idempotency key.
"""

import hashlib
import hmac
import json
import os
import time
from datetime import UTC, datetime, timedelta
from uuid import UUID

import httpx
from fastapi import HTTPException


def mode():
    return os.getenv("PAYMENTS_MODE", "demo")


def validate_settings():
    if mode() not in {"demo", "stripe_test"}:
        raise RuntimeError("PAYMENTS_MODE must be demo or stripe_test")
    if mode() == "stripe_test":
        if not os.getenv("STRIPE_SECRET_KEY", "").startswith("sk_test_"):
            raise RuntimeError("A Stripe test secret key is required; live payments are disabled")
        if not os.getenv("STRIPE_WEBHOOK_SECRET", "").startswith("whsec_"):
            raise RuntimeError("STRIPE_WEBHOOK_SECRET is required")
        if not os.getenv("PUBLIC_URL", "").startswith(("http://localhost:", "http://127.0.0.1:", "https://")):
            raise RuntimeError("PUBLIC_URL must be HTTPS or a loopback development URL")


def stripe_request(path, data=None, key=None):
    validate_settings()
    if mode() != "stripe_test":
        raise HTTPException(409, "Payments are disabled in demo mode")
    headers = {"Authorization": "Bearer " + os.environ["STRIPE_SECRET_KEY"]}
    if key:
        headers["Idempotency-Key"] = key
    # Omit a Stripe-Version override: configure the account and webhook endpoint
    # together, then run the documented sandbox acceptance check before activation.
    try:
        with httpx.Client(timeout=15) as client:
            response = client.request(
                "POST" if data is not None else "GET",
                "https://api.stripe.com/v1/" + path,
                headers=headers,
                data=data,
            )
        if response.is_error:
            raise HTTPException(502, "Payment provider unavailable; retry this request")
        return response.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, "Payment provider unavailable; retry this request") from None


def expire_holds(conn, listing_id=None):
    # Keep the exclusion constraint authoritative; never merely hide expired rows.
    conn.execute(
        """UPDATE booking SET status = 'cancelled', cancelled_at = now()
        WHERE status = 'held' AND hold_expires_at <= now()
        AND (%s::uuid IS NULL OR listing_id = %s)""",
        (listing_id, listing_id),
    )


def checkout(conn, booking_id, customer_id):
    with conn.transaction():
        row = conn.execute(
            "SELECT * FROM booking WHERE id = %s AND customer_id = %s FOR UPDATE", (booking_id, customer_id)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Booking not found")
        if row["status"] != "held" or row["hold_expires_at"] <= datetime.now(UTC):
            raise HTTPException(409, "This reservation is no longer awaiting payment")
        if row["checkout_url"]:
            return {"url": row["checkout_url"]}
        if row["hold_expires_at"] < datetime.now(UTC) + timedelta(minutes=31):
            raise HTTPException(409, "Checkout was not started in time. Cancel this hold and reserve again.")
    # Stable parameters and key make retry after a timeout safe.
    origin = os.environ["PUBLIC_URL"].rstrip("/")
    result = stripe_request(
        "checkout/sessions",
        {
            "mode": "payment",
            "payment_method_types[0]": "card",
            "client_reference_id": str(booking_id),
            "metadata[booking_id]": str(booking_id),
            "success_url": origin + "/?view=bookings&checkout=returned",
            "cancel_url": origin + "/?view=bookings",
            "expires_at": str(int(row["hold_expires_at"].timestamp())),
            "line_items[0][price_data][currency]": "usd",
            "line_items[0][price_data][unit_amount]": str(row["total_price_cents"]),
            "line_items[0][price_data][product_data][name]": "Parking reservation (test)",
            "line_items[0][quantity]": "1",
        },
        key="checkout-" + str(booking_id),
    )
    if not str(result.get("url", "")).startswith("https://checkout.stripe.com/"):
        raise HTTPException(502, "Payment provider returned an invalid checkout link")
    with conn.transaction():
        conn.execute(
            "UPDATE booking SET checkout_id = %s, checkout_url = %s WHERE id = %s",
            (result["id"], result["url"], booking_id),
        )
    return {"url": result["url"]}


def signed_event(payload: bytes, signature: str):
    secret = os.getenv("STRIPE_WEBHOOK_SECRET", "")
    if not secret or mode() != "stripe_test":
        raise HTTPException(503, "Payment webhooks are not configured")
    try:
        parts = [part.split("=", 1) for part in signature.split(",")]
        timestamp = next(value for key, value in parts if key == "t")
        if abs(time.time() - int(timestamp)) > 300:
            raise ValueError("Expired signature")
        digest = hmac.new(secret.encode(), timestamp.encode() + b"." + payload, hashlib.sha256).hexdigest()
        if not any(key == "v1" and hmac.compare_digest(value, digest) for key, value in parts):
            raise ValueError("Bad signature")
        event = json.loads(payload)
        if event.get("livemode") is not False or not isinstance(event.get("id"), str):
            raise ValueError("Only test events are accepted")
        return event
    except (ValueError, StopIteration, TypeError, AttributeError):
        raise HTTPException(400, "Invalid webhook signature or payload") from None


def queue_refund(conn, row, payment_intent):
    conn.execute(
        """INSERT INTO refund_job(booking_id, payment_intent) VALUES (%s, %s)
        ON CONFLICT (booking_id) DO NOTHING""",
        (row["id"], payment_intent),
    )
    conn.execute(
        "UPDATE booking SET payment_status = 'refund_pending', payment_intent = %s WHERE id = %s",
        (payment_intent, row["id"]),
    )


def process_event(conn, event):
    if event.get("type") not in {"checkout.session.completed", "checkout.session.expired"}:
        return
    session = event.get("data", {}).get("object", {})
    try:
        booking_id = UUID(session.get("client_reference_id", ""))
    except (ValueError, TypeError):
        raise HTTPException(400, "Missing booking reference") from None
    with conn.transaction():
        inserted = conn.execute(
            "INSERT INTO payment_event(id) VALUES (%s) ON CONFLICT DO NOTHING RETURNING id", (event["id"],)
        ).fetchone()
        if not inserted:
            return
        row = conn.execute("SELECT * FROM booking WHERE id = %s FOR UPDATE", (booking_id,)).fetchone()
        if not row or row["payment_status"] == "demo":
            raise HTTPException(400, "Unknown payment booking")
        if row["checkout_id"] and row["checkout_id"] != session.get("id"):
            raise HTTPException(400, "Checkout reference mismatch")
        if event["type"] == "checkout.session.expired":
            if row["status"] == "held":
                conn.execute(
                    "UPDATE booking SET status = 'cancelled', cancelled_at = now() WHERE id = %s",
                    (booking_id,),
                )
            return
        if session.get("payment_status") != "paid":
            return  # Card-only Checkout; never fulfill an unpaid session.
        intent = session.get("payment_intent")
        if (
            session.get("amount_total") != row["total_price_cents"]
            or session.get("currency") != "usd"
            or not isinstance(intent, str)
            or not intent.startswith("pi_")
        ):
            raise HTTPException(400, "Payment amount, currency or reference mismatch")
        if row["payment_status"] in {"paid", "refund_pending", "refunded"}:
            if row["payment_intent"] != intent:
                raise HTTPException(400, "Payment intent mismatch")
            return
        conn.execute(
            "UPDATE booking SET checkout_id = %s, payment_intent = %s WHERE id = %s",
            (session["id"], intent, booking_id),
        )
        if (
            row["status"] == "held"
            and row["hold_expires_at"] > datetime.now(UTC)
            and row["starts_at"] > datetime.now(UTC)
        ):
            conn.execute(
                "UPDATE booking SET status = 'confirmed', payment_status = 'paid' WHERE id = %s",
                (booking_id,),
            )
        else:
            conn.execute(
                "UPDATE booking SET status = 'cancelled', cancelled_at = now() WHERE id = %s", (booking_id,)
            )
            queue_refund(conn, row, intent)


def process_refunds(conn):
    # A session advisory lock permits one worker across processes without keeping a
    # database transaction open during an external request. Crashes release the lock.
    if not conn.execute("SELECT pg_try_advisory_lock(71024002) AS acquired").fetchone()["acquired"]:
        return
    try:
        jobs = conn.execute("""SELECT * FROM refund_job WHERE completed_at IS NULL
            AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT 25""").fetchall()
        for job in jobs:
            try:
                result = (
                    stripe_request("refunds/" + job["refund_id"])
                    if job["refund_id"]
                    else stripe_request(
                        "refunds",
                        {"payment_intent": job["payment_intent"]},
                        key="refund-" + str(job["booking_id"]),
                    )
                )
                with conn.transaction():
                    conn.execute(
                        """UPDATE refund_job SET refund_id = %s, attempts = attempts + 1,
                        next_attempt_at = now() + interval '1 minute', last_error = %s
                        WHERE booking_id = %s""",
                        (
                            result["id"],
                            None if result["status"] == "succeeded" else result["status"],
                            job["booking_id"],
                        ),
                    )
                    if result["status"] == "succeeded":
                        conn.execute(
                            "UPDATE refund_job SET completed_at = now() WHERE booking_id = %s",
                            (job["booking_id"],),
                        )
                        conn.execute(
                            "UPDATE booking SET payment_status = 'refunded' WHERE id = %s",
                            (job["booking_id"],),
                        )
            except (HTTPException, KeyError):
                conn.execute(
                    """UPDATE refund_job SET attempts = attempts + 1,
                    next_attempt_at = now() + interval '1 minute', last_error = 'provider_unavailable'
                    WHERE booking_id = %s""",
                    (job["booking_id"],),
                )
    finally:
        conn.execute("SELECT pg_advisory_unlock(71024002)")
