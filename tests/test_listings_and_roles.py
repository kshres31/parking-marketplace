from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo

from parking.migrate import MIGRATIONS, migrate
from tests.test_api import PASSWORD, account, contend, interval, listing, reserve

pytestmark = pytest.mark.integration
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def create(client, owner, **fields):
    body = {
        "title": "Detailed garage",
        "address": "Fictional demonstration parking",
        "latitude": 41.88,
        "longitude": -87.63,
        "hourly_price_cents": 400,
        **fields,
    }
    return client.post("/listings", headers=owner, json=body)


def search(client, **params):
    return client.get("/listings", params={**interval(), "latitude": 41.88, "longitude": -87.63, **params})


def upload(client, owner, space, data=PNG, content_type="image/png"):
    return client.post(
        f"/listings/{space}/images", headers={**owner, "Content-Type": content_type}, content=data
    )


# Roles and authorization


def test_registration_role_is_returned_and_defaults_to_customer(client):
    default = client.post("/auth/register", json={"username": "plain", "password": PASSWORD})
    assert default.status_code == 201 and default.json()["user"]["role"] == "customer"
    owner = account(client, "host", "owner")
    assert client.get("/me", headers=owner).json()["role"] == "owner"
    login = client.post("/auth/login", json={"username": "host", "password": PASSWORD})
    assert login.json()["user"]["role"] == "owner"
    bad = client.post("/auth/register", json={"username": "admin", "password": PASSWORD, "role": "admin"})
    assert bad.status_code == 422
    # Login does not accept a role, so a session cannot claim a different one.
    assert (
        client.post("/auth/login", json={"username": "host", "password": PASSWORD, "role": "customer"})
    ).status_code == 422


def test_customers_cannot_host_and_owners_cannot_book(client):
    owner, customer = account(client, "owner", "owner"), account(client, "customer")
    space = listing(client, owner)
    assert create(client, customer).status_code == 403
    assert client.get("/host/listings", headers=customer).status_code == 403
    assert client.get("/host/bookings", headers=customer).status_code == 403
    assert client.patch(f"/listings/{space}", headers=customer, json={"active": False}).status_code == 403
    assert client.delete(f"/listings/{space}", headers=customer).status_code == 403
    assert upload(client, customer, space).status_code == 403
    assert reserve(client, owner, space, interval()).status_code == 403
    assert client.get("/bookings", headers=owner).status_code == 403
    booking = reserve(client, customer, space, interval()).json()
    assert client.post(f"/bookings/{booking['id']}/cancel", headers=owner).status_code == 403
    assert client.post(f"/bookings/{booking['id']}/checkout", headers=owner).status_code == 403
    assert create(client, owner).status_code == 201


def test_migration_promotes_existing_hosts_to_owner(database_url, tmp_path):
    for path in sorted(MIGRATIONS.glob("*.sql"))[:3]:
        (tmp_path / path.name).write_bytes(path.read_bytes())
    name = "parking_upgrade_" + uuid4().hex
    with psycopg.connect(database_url, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(sql.Identifier(name)))
    url = make_conninfo(database_url, dbname=name)
    try:
        migrate(url, tmp_path)
        host, guest = uuid4(), uuid4()
        with psycopg.connect(url) as conn:
            conn.execute(
                """INSERT INTO account(id, username, password_hash)
                VALUES (%s, 'host', 'x'), (%s, 'guest', 'x')""",
                (host, guest),
            )
            conn.execute(
                """INSERT INTO listing(id, owner_id, title, address, location, hourly_price_cents)
                VALUES (%s, %s, 'Old space', 'Old address', 'POINT(-87.63 41.88)', 300)""",
                (uuid4(), host),
            )
        migrate(url)
        with psycopg.connect(url) as conn:
            roles = dict(conn.execute("SELECT username, role FROM account").fetchall())
            assert roles == {"host": "owner", "guest": "customer"}
            assert conn.execute("SELECT description, features FROM listing").fetchone() == ("", [])
    finally:
        with psycopg.connect(database_url, autocommit=True) as admin:
            admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))


# Listing details and updates


def test_listing_details_are_validated_and_public(client):
    owner = account(client, "owner", "owner")
    created = create(
        client, owner, description="Covered bay near the river.", features=["covered", "ev_charging"]
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["description"] == "Covered bay near the river."
    assert body["features"] == ["covered", "ev_charging"] and body["image_ids"] == []
    detail = client.get(f"/listings/{body['id']}").json()
    assert detail["latitude"] == pytest.approx(41.88) and "owner_id" not in detail
    assert create(client, owner, features=["helipad"]).status_code == 422
    assert create(client, owner, description="x" * 2001).status_code == 422
    assert create(client, owner, hourly_price_cents=0).status_code == 422
    assert client.get(f"/listings/{uuid4()}").status_code == 404


def test_owner_updates_listing_fields_without_repricing_bookings(client):
    owner, other, customer = (
        account(client, "owner", "owner"),
        account(client, "other", "owner"),
        account(client, "customer"),
    )
    space = listing(client, owner)
    booking = reserve(client, customer, space, interval()).json()
    changed = client.patch(
        f"/listings/{space}",
        headers=owner,
        json={
            "title": "Renamed garage",
            "hourly_price_cents": 900,
            "latitude": 41.9,
            "longitude": -87.6,
            "features": ["security", "security"],
        },
    )
    assert changed.status_code == 200, changed.text
    row = changed.json()
    assert row["title"] == "Renamed garage" and row["hourly_price_cents"] == 900
    assert row["latitude"] == pytest.approx(41.9) and row["features"] == ["security"]
    assert (
        client.get("/bookings", headers=customer).json()[0]["total_price_cents"]
        == booking["total_price_cents"]
    )
    assert client.patch(f"/listings/{space}", headers=other, json={"title": "Mine now"}).status_code == 404
    for invalid in ({}, {"latitude": 1}, {"title": None}, {"owner_id": str(uuid4())}, {"active": "no"}):
        assert client.patch(f"/listings/{space}", headers=owner, json=invalid).status_code == 422


# Search filters


def test_search_filters_by_price_and_features_and_sorts_by_price(client):
    owner = account(client, "owner", "owner")
    cheap_far = create(client, owner, hourly_price_cents=200, longitude=-87.64).json()["id"]
    pricey_near = create(client, owner, hourly_price_cents=800, features=["covered"]).json()["id"]
    mid = create(client, owner, hourly_price_cents=500, features=["covered", "ev_charging"]).json()["id"]
    assert [r["id"] for r in search(client, sort="price").json()] == [cheap_far, mid, pricey_near]
    assert {r["id"] for r in search(client, max_price_cents=500).json()} == {cheap_far, mid}
    assert {r["id"] for r in search(client, features=["covered"]).json()} == {pricey_near, mid}
    both = search(client, features=["covered", "ev_charging"], max_price_cents=600).json()
    assert [r["id"] for r in both] == [mid]
    assert search(client, features=["helipad"]).status_code == 422
    assert search(client, sort="rating").status_code == 422


# Deletion


def test_delete_removes_unbooked_listing_and_archives_booked_history(client, database_url):
    owner, customer = account(client, "owner", "owner"), account(client, "customer")
    unbooked = listing(client, owner)
    assert upload(client, owner, unbooked).status_code == 201
    assert client.delete(f"/listings/{unbooked}", headers=owner).json()["outcome"] == "deleted"
    assert client.get(f"/listings/{unbooked}").status_code == 404
    assert client.delete(f"/listings/{unbooked}", headers=owner).status_code == 404

    booked = listing(client, owner)
    booking = reserve(client, customer, booked, interval()).json()
    assert client.delete(f"/listings/{booked}", headers=owner).status_code == 409
    with psycopg.connect(database_url) as conn:
        # Make the reservation historical: it ended yesterday.
        conn.execute(
            """UPDATE booking SET starts_at = now() - interval '2 days', ends_at = now() - interval '1 day'
            WHERE id = %s""",
            (booking["id"],),
        )
    assert client.delete(f"/listings/{booked}", headers=owner).json()["outcome"] == "archived"
    assert client.get("/host/listings", headers=owner).json() == []
    assert client.get(f"/listings/{booked}").status_code == 404
    assert search(client).json() == []
    assert reserve(client, customer, booked, interval()).status_code == 404
    assert client.patch(f"/listings/{booked}", headers=owner, json={"active": True}).status_code == 404
    history = client.get("/bookings", headers=customer).json()
    assert [(row["id"], row["title"]) for row in history] == [(booking["id"], "Demo garage")]
    assert len(client.get("/host/bookings", headers=owner).json()) == 1


def test_cancelled_reservations_do_not_block_deletion(client):
    owner, customer = account(client, "owner", "owner"), account(client, "customer")
    space = listing(client, owner)
    booking = reserve(client, customer, space, interval()).json()
    client.post(f"/bookings/{booking['id']}/cancel", headers=customer)
    assert client.delete(f"/listings/{space}", headers=owner).json()["outcome"] == "archived"


def test_concurrent_delete_and_reservation_never_strand_a_booking(client, database_url):
    owner = account(client, "owner", "owner")
    customers = [account(client, f"customer_{i}") for i in range(3)]
    for customer in customers:
        space, period = listing(client, owner), interval()
        booked, deleted = contend(
            client,
            database_url,
            space,
            [
                lambda c=customer, s=space, p=period: reserve(client, c, s, p),
                lambda s=space: client.delete(f"/listings/{s}", headers=owner),
            ],
        )
        outcomes = (booked.status_code, deleted.status_code)
        assert outcomes in {(201, 409), (404, 200)}, (booked.text, deleted.text)
        with psycopg.connect(database_url) as conn:
            live = conn.execute(
                """SELECT count(*) FROM booking b JOIN listing l ON l.id = b.listing_id
                WHERE b.status = 'confirmed' AND NOT l.active""",
            ).fetchone()[0]
            assert live == 0


# Images


def test_image_upload_serving_and_removal(client):
    owner, other = account(client, "owner", "owner"), account(client, "other", "owner")
    space = listing(client, owner)
    stored = upload(client, owner, space)
    assert stored.status_code == 201, stored.text
    assert stored.json()["content_type"] == "image/png" and stored.json()["bytes"] == len(PNG)
    image_id = stored.json()["id"]
    fetched = client.get(f"/listings/{space}/images/{image_id}")
    assert fetched.status_code == 200 and fetched.content == PNG
    assert fetched.headers["content-type"] == "image/png"
    assert "immutable" in fetched.headers["cache-control"]
    assert "sandbox" in fetched.headers["content-security-policy"]
    assert search(client).json()[0]["image_ids"] == [image_id]
    assert client.get(f"/listings/{uuid4()}/images/{image_id}").status_code == 404
    assert client.delete(f"/listings/{space}/images/{image_id}", headers=other).status_code == 404
    assert client.delete(f"/listings/{space}/images/{image_id}", headers=owner).status_code == 204
    assert client.get(f"/listings/{space}/images/{image_id}").status_code == 404


def test_image_uploads_are_type_checked_and_size_limited(client):
    owner, other = account(client, "owner", "owner"), account(client, "other", "owner")
    space = listing(client, owner)
    assert upload(client, owner, space, b"<svg onload=alert(1)>", "image/svg+xml").status_code == 415
    assert upload(client, owner, space, b"GIF89a" + b"\x00" * 10, "image/png").status_code == 415
    assert upload(client, owner, space, JPEG, "image/png").status_code == 415
    assert upload(client, owner, space, JPEG, "image/jpeg").status_code == 201
    webp = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x00" * 16
    assert upload(client, owner, space, webp, "image/webp").status_code == 201
    too_big = PNG + b"\x00" * (2 * 1024 * 1024)
    assert upload(client, owner, space, too_big).status_code == 413
    assert upload(client, other, space).status_code == 404
    # The ordinary JSON limit still applies everywhere else.
    assert create(client, owner, description="x" * 70000).status_code == 413


def test_concurrent_uploads_respect_image_limit(client):
    owner = account(client, "owner", "owner")
    space = listing(client, owner)
    with ThreadPoolExecutor(max_workers=10) as pool:
        codes = sorted(pool.map(lambda _: upload(client, owner, space).status_code, range(10)))
    assert codes == [201] * 6 + [409] * 4
    assert len(client.get(f"/listings/{space}").json()["image_ids"]) == 6


def test_archived_listing_images_are_not_served(client, database_url):
    owner, customer = account(client, "owner", "owner"), account(client, "customer")
    space = listing(client, owner)
    image_id = upload(client, owner, space).json()["id"]
    booking = reserve(client, customer, space, interval()).json()
    client.post(f"/bookings/{booking['id']}/cancel", headers=customer)
    client.delete(f"/listings/{space}", headers=owner)
    assert client.get(f"/listings/{space}/images/{image_id}").status_code == 404


def test_paused_listing_detail_is_hidden(client):
    owner = account(client, "owner", "owner")
    space = listing(client, owner)
    client.patch(f"/listings/{space}", headers=owner, json={"active": False})
    assert client.get(f"/listings/{space}").status_code == 404
