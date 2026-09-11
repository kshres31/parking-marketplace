import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import psycopg
import pytest

from parking.app import token_hash

pytestmark = pytest.mark.integration
PASSWORD = "a-local-test-password-only"


def account(client, name):
    response = client.post("/auth/register", json={"username": name, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return {"Authorization": "Bearer " + response.json()["access_token"]}


def listing(client, owner, longitude=-87.63):
    response = client.post(
        "/listings",
        headers=owner,
        json={
            "title": "Demo garage",
            "address": "Fictional demonstration parking",
            "latitude": 41.88,
            "longitude": longitude,
            "hourly_price_cents": 301,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def interval():
    start = datetime.now(UTC).replace(microsecond=0) + timedelta(days=2)
    return {"starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=1)).isoformat()}


def reserve(client, customer, space, period, key=None):
    return client.post(
        "/bookings",
        headers={**customer, "Idempotency-Key": key or str(uuid4())},
        json={"listing_id": space, **period},
    )


def test_auth_stores_hashes_and_logout_revokes_token(client, database_url):
    auth = account(client, "alice")
    assert client.get("/me", headers=auth).json()["username"] == "alice"
    with psycopg.connect(database_url) as conn:
        hashed = conn.execute("SELECT password_hash FROM account").fetchone()[0]
        assert hashed.startswith("$argon2id$") and PASSWORD not in hashed
        assert conn.execute("SELECT token_hash FROM session").fetchone()[0] == token_hash(
            auth["Authorization"].removeprefix("Bearer ")
        )
    assert (
        client.post("/auth/login", json={"username": "alice", "password": "wrong-password-long"}).status_code
        == 401
    )
    assert client.post("/auth/logout", headers=auth).status_code == 204
    assert client.get("/me", headers=auth).status_code == 401
    login = client.post("/auth/login", json={"username": "alice", "password": PASSWORD})
    assert login.status_code == 200
    assert client.post("/auth/register", json={"username": "alice", "password": PASSWORD}).status_code == 409


def test_expired_and_missing_sessions_are_rejected(client, database_url):
    auth = account(client, "alice")
    with psycopg.connect(database_url) as conn:
        conn.execute("UPDATE session SET expires_at = now() - interval '1 second'")
    assert client.get("/me", headers=auth).status_code == 401
    assert client.get("/bookings").status_code == 401


def test_search_filters_distance_availability_and_allows_adjacent_booking(client):
    owner, customer = account(client, "owner"), account(client, "customer")
    space = listing(client, owner)
    listing(client, owner, longitude=-90)
    period = interval()
    query = {**period, "latitude": 41.88, "longitude": -87.63, "radius_m": 1000}
    found = client.get("/listings", params=query)
    assert found.status_code == 200, found.text
    assert [row["id"] for row in found.json()] == [space]
    booked = reserve(client, customer, space, period)
    assert booked.status_code == 201, booked.text
    assert booked.json()["total_price_cents"] == 301
    assert client.get("/listings", params=query).json() == []
    next_period = {
        "starts_at": period["ends_at"],
        "ends_at": (datetime.fromisoformat(period["ends_at"]) + timedelta(hours=1)).isoformat(),
    }
    assert reserve(client, customer, space, next_period).status_code == 201


def test_idempotency_and_cancellation_do_not_resurrect_reservations(client):
    owner, customer = account(client, "owner"), account(client, "customer")
    space, period, key = listing(client, owner), interval(), str(uuid4())
    original = reserve(client, customer, space, period, key)
    assert original.status_code == 201
    replay = reserve(client, customer, space, period, key)
    assert replay.status_code == 200 and replay.json()["id"] == original.json()["id"]
    changed = {
        **period,
        "ends_at": (datetime.fromisoformat(period["ends_at"]) + timedelta(hours=1)).isoformat(),
    }
    assert reserve(client, customer, space, changed, key).status_code == 409
    booking_id = original.json()["id"]
    assert client.post(f"/bookings/{booking_id}/cancel", headers=customer).json()["status"] == "cancelled"
    assert client.post(f"/bookings/{booking_id}/cancel", headers=customer).status_code == 200
    assert reserve(client, customer, space, period, key).json()["status"] == "cancelled"
    assert reserve(client, customer, space, period).status_code == 201


def test_account_boundaries_and_listing_deactivation(client):
    owner, customer, stranger = (
        account(client, "owner"),
        account(client, "customer"),
        account(client, "stranger"),
    )
    space, period = listing(client, owner), interval()
    assert reserve(client, owner, space, period).status_code == 403
    booked = reserve(client, customer, space, period).json()
    assert client.get("/bookings", headers=stranger).json() == []
    assert client.post(f"/bookings/{booked['id']}/cancel", headers=stranger).status_code == 404
    assert client.patch(f"/listings/{space}", headers=stranger, json={"active": False}).status_code == 404
    assert client.patch(f"/listings/{space}", headers=owner, json={"active": False}).status_code == 200
    assert client.get("/bookings", headers=customer).json()[0]["status"] == "confirmed"
    assert reserve(client, stranger, space, period).status_code == 404


def contend(client, database_url, space, calls):
    with psycopg.connect(database_url) as blocker, ThreadPoolExecutor(max_workers=len(calls)) as pool:
        blocker.execute("SELECT id FROM listing WHERE id = %s FOR UPDATE", (space,))
        futures = [pool.submit(call) for call in calls]
        try:
            with psycopg.connect(database_url, autocommit=True) as observer:
                deadline = time.monotonic() + 3
                while (
                    observer.execute("""SELECT count(*) FROM pg_stat_activity
                    WHERE application_name = 'parking-api'
                      AND cardinality(pg_blocking_pids(pid)) > 0""").fetchone()[
                        0
                    ]
                    < len(calls)
                ):
                    assert time.monotonic() < deadline, "Requests did not reach database lock contention"
                    time.sleep(0.01)
        finally:
            blocker.rollback()
        return [future.result(timeout=15) for future in futures]


def test_eight_competing_customers_commit_exactly_one_booking(client, database_url):
    owner = account(client, "owner")
    space, period = listing(client, owner), interval()
    customers = [account(client, f"customer_{index}") for index in range(8)]
    responses = contend(
        client,
        database_url,
        space,
        [lambda user=user: reserve(client, user, space, period) for user in customers],
    )
    assert sorted(response.status_code for response in responses) == [201] + [409] * 7
    with psycopg.connect(database_url) as conn:
        assert conn.execute("SELECT count(*) FROM booking WHERE status = 'confirmed'").fetchone()[0] == 1


def test_concurrent_retries_commit_once(client, database_url):
    owner, customer = account(client, "owner"), account(client, "customer")
    space, period, key = listing(client, owner), interval(), str(uuid4())
    responses = contend(
        client, database_url, space, [lambda: reserve(client, customer, space, period, key)] * 2
    )
    assert sorted(response.status_code for response in responses) == [200, 201]
    assert responses[0].json()["id"] == responses[1].json()["id"]
    assert len(client.get("/bookings", headers=customer).json()) == 1


def test_failed_insert_can_be_retried_without_consuming_key(client, database_url):
    owner, customer = account(client, "owner"), account(client, "customer")
    space, period = listing(client, owner), interval()
    original = reserve(client, customer, space, period)
    key = str(uuid4())
    assert reserve(client, customer, space, period, key).status_code == 409
    client.post(f"/bookings/{original.json()['id']}/cancel", headers=customer)
    assert reserve(client, customer, space, period, key).status_code == 201


def test_bad_interval_and_past_booking_are_rejected(client):
    owner, customer = account(client, "owner"), account(client, "customer")
    space, period = listing(client, owner), interval()
    assert reserve(client, customer, space, {**period, "ends_at": period["starts_at"]}).status_code == 422
    past = datetime.now(UTC) - timedelta(days=2)
    assert (
        reserve(
            client,
            customer,
            space,
            {"starts_at": past.isoformat(), "ends_at": (past + timedelta(hours=1)).isoformat()},
        ).status_code
        == 422
    )
    assert client.get("/listings", params={**period, "latitude": 91, "longitude": 0}).status_code == 422


def test_request_cannot_choose_another_customer_or_omit_retry_key(client):
    owner, customer = account(client, "owner"), account(client, "customer")
    space, period = listing(client, owner), interval()
    assert client.post("/bookings", headers=customer, json={"listing_id": space, **period}).status_code == 422
    response = client.post(
        "/bookings",
        headers={**customer, "Idempotency-Key": str(uuid4())},
        json={"listing_id": space, "customer_id": str(uuid4()), **period},
    )
    assert response.status_code == 422
    assert client.get("/bookings", headers=customer).json() == []
