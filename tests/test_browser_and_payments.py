import hashlib
import hmac
import json
import time
from uuid import uuid4

import psycopg
import pytest
from fastapi import HTTPException
from psycopg.rows import dict_row

from parking import payments
from tests.test_api import PASSWORD, account, interval, listing, reserve

pytestmark = pytest.mark.integration


@pytest.fixture
def stripe_mode(monkeypatch):
    monkeypatch.setenv("PAYMENTS_MODE", "stripe_test")
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_local_fixture_not_a_real_key")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_local_fixture_only")
    monkeypatch.setenv("PUBLIC_URL", "http://localhost:8000")


def event_for(booking, **changes):
    session = {
        "id": "cs_test_" + booking["id"],
        "client_reference_id": booking["id"],
        "payment_intent": "pi_" + booking["id"],
        "amount_total": booking["total_price_cents"],
        "currency": "usd",
        "payment_status": "paid",
    }
    session.update(changes)
    return {
        "id": "evt_" + str(uuid4()),
        "livemode": False,
        "type": "checkout.session.completed",
        "data": {"object": session},
    }


def webhook(client, event, age=0, bad=False):
    payload = json.dumps(event).encode()
    stamp = str(int(time.time()) - age)
    signature = hmac.new(
        b"whsec_local_fixture_only", stamp.encode() + b"." + payload, hashlib.sha256
    ).hexdigest()
    return client.post(
        "/payments/webhook",
        content=payload,
        headers={"Stripe-Signature": f"t={stamp},v1={'0' * 64 if bad else signature}"},
    )


def held_booking(client):
    owner, customer = account(client, "owner"), account(client, "customer")
    space = listing(client, owner)
    response = reserve(client, customer, space, interval())
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "held"
    return customer, response.json()


def test_browser_cookie_session_requires_origin_and_never_returns_token(client):
    data = {"username": "browser_user", "password": PASSWORD}
    header = {"X-Browser-Session": "1", "Origin": "http://testserver"}
    assert client.post("/auth/register", json=data, headers={"X-Browser-Session": "1"}).status_code == 403
    response = client.post("/auth/register", json=data, headers=header)
    assert response.status_code == 201
    assert "access_token" not in response.json()
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie
    assert client.get("/me").json()["username"] == "browser_user"
    assert client.post("/auth/logout").status_code == 403
    assert (
        client.post("/auth/logout", headers={**header, "Origin": "https://attacker.invalid"}).status_code
        == 403
    )
    assert client.post("/auth/logout", headers=header).status_code == 204
    assert client.get("/me").status_code == 401


def test_auth_limit_and_request_size(client, monkeypatch):
    monkeypatch.setenv("AUTH_RATE_LIMIT", "2")
    for _ in range(2):
        assert (
            client.post("/auth/login", json={"username": "unknown", "password": PASSWORD}).status_code == 401
        )
    blocked = client.post("/auth/login", json={"username": "unknown", "password": PASSWORD})
    assert blocked.status_code == 429 and blocked.headers["Retry-After"] == "600"
    assert client.post("/auth/register", content=b"x" * 65537).status_code == 413


def test_host_views_do_not_expose_other_owners(client):
    owner, customer, other = account(client, "owner"), account(client, "customer"), account(client, "other")
    space = listing(client, owner)
    reserve(client, customer, space, interval())
    assert len(client.get("/host/listings", headers=owner).json()) == 1
    assert client.get("/host/listings", headers=other).json() == []
    rows = client.get("/host/bookings", headers=owner).json()
    assert len(rows) == 1 and rows[0]["customer"] == "customer"
    assert "password_hash" not in rows[0] and "payment_intent" not in rows[0]
    assert client.get("/host/bookings", headers=other).json() == []


def test_paid_webhook_is_verified_idempotent_and_does_not_regress(client, database_url, stripe_mode):
    _, booking = held_booking(client)
    event = event_for(booking)
    assert webhook(client, event, bad=True).status_code == 400
    assert webhook(client, event, age=600).status_code == 400
    assert webhook(client, event_for(booking, amount_total=1)).status_code == 400
    assert webhook(client, event).status_code == 200
    assert webhook(client, event).status_code == 200
    expired = {**event, "id": "evt_expired", "type": "checkout.session.expired"}
    assert webhook(client, expired).status_code == 200
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        row = conn.execute("SELECT * FROM booking").fetchone()
        assert row["status"] == "confirmed" and row["payment_status"] == "paid"
        assert conn.execute("SELECT count(*) AS n FROM payment_event").fetchone()["n"] == 2
        assert conn.execute("SELECT count(*) AS n FROM refund_job").fetchone()["n"] == 0


def test_expired_hold_releases_space_and_late_payment_queues_refund(client, database_url, stripe_mode):
    customer, booking = held_booking(client)
    with psycopg.connect(database_url) as conn:
        conn.execute("UPDATE booking SET hold_expires_at = now() - interval '1 minute'")
    replacement = reserve(
        client,
        customer,
        booking["listing_id"],
        {"starts_at": booking["starts_at"], "ends_at": booking["ends_at"]},
    )
    assert replacement.status_code == 201
    assert webhook(client, event_for(booking)).status_code == 200
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        old = conn.execute("SELECT * FROM booking WHERE id = %s", (booking["id"],)).fetchone()
        assert old["status"] == "cancelled" and old["payment_status"] == "refund_pending"
        assert conn.execute("SELECT count(*) AS n FROM refund_job").fetchone()["n"] == 1
        assert conn.execute("SELECT count(*) AS n FROM booking WHERE status = 'held'").fetchone()["n"] == 1


def test_cancelled_paid_booking_refund_retries_with_same_key(client, database_url, stripe_mode, monkeypatch):
    customer, booking = held_booking(client)
    assert webhook(client, event_for(booking)).status_code == 200
    response = client.post(f"/bookings/{booking['id']}/cancel", headers=customer)
    assert response.status_code == 200 and response.json()["payment_status"] == "refund_pending"
    calls = []

    def provider(path, data=None, key=None):
        calls.append((path, data, key))
        if len(calls) == 1:
            raise HTTPException(502, "Simulated lost response")
        return {"id": "re_test", "status": "succeeded"}

    monkeypatch.setattr(payments, "stripe_request", provider)
    with psycopg.connect(database_url, autocommit=True, row_factory=dict_row) as conn:
        payments.process_refunds(conn)
        assert conn.execute("SELECT attempts FROM refund_job").fetchone()["attempts"] == 1
        conn.execute("UPDATE refund_job SET next_attempt_at = now()")
        payments.process_refunds(conn)
        payments.process_refunds(conn)
        assert conn.execute("SELECT payment_status FROM booking").fetchone()["payment_status"] == "refunded"
    assert len(calls) == 2 and calls[0] == calls[1]
    # A different event ID for the same paid session cannot undo a completed refund.
    assert webhook(client, event_for(booking)).status_code == 200
    assert client.get("/bookings", headers=customer).json()[0]["payment_status"] == "refunded"


def test_checkout_retry_uses_stored_price_and_stable_request(client, stripe_mode, monkeypatch):
    customer, booking = held_booking(client)
    calls = []

    def provider(path, data=None, key=None):
        calls.append((path, data, key))
        if len(calls) == 1:
            raise HTTPException(502, "Simulated timeout")
        return {"id": "cs_test_" + booking["id"], "url": "https://checkout.stripe.com/c/pay/cs_test_example"}

    monkeypatch.setattr(payments, "stripe_request", provider)
    path = f"/bookings/{booking['id']}/checkout"
    assert client.post(path, headers=customer).status_code == 502
    assert client.post(path, headers=customer).status_code == 200
    assert client.post(path, headers=customer).status_code == 200
    assert len(calls) == 2 and calls[0] == calls[1]
    assert calls[0][1]["line_items[0][price_data][unit_amount]"] == str(booking["total_price_cents"])


def test_cancel_before_payment_is_compensated(client, database_url, stripe_mode):
    customer, booking = held_booking(client)
    assert client.post(f"/bookings/{booking['id']}/cancel", headers=customer).status_code == 200
    assert webhook(client, event_for(booking)).status_code == 200
    with psycopg.connect(database_url) as conn:
        assert conn.execute("SELECT status, payment_status FROM booking").fetchone() == (
            "cancelled",
            "refund_pending",
        )
