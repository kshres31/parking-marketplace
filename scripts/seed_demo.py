"""Insert fictional Chicago listings once. No shared login or customer data."""

import os
from uuid import NAMESPACE_URL, uuid5

import psycopg

SPACES = [
    ("Riverwalk covered space", "Demo · River North", 41.889, -87.630, 450),
    ("The Loop courtyard", "Demo · The Loop", 41.882, -87.629, 350),
    ("West Loop garage", "Demo · West Loop", 41.880, -87.643, 500),
    ("Printer’s Row parking", "Demo · South Loop", 41.873, -87.629, 275),
    ("Lakeside open-air space", "Demo · Near Grant Park", 41.878, -87.623, 600),
    ("Fulton corner space", "Demo · Fulton Market", 41.886, -87.651, 400),
]


def seed(url):
    if os.getenv("PAYMENTS_MODE", "demo") != "demo":
        raise RuntimeError("Demo seeding is only available in demo mode")
    owner = uuid5(NAMESPACE_URL, "parkside:fictional-owner")
    with psycopg.connect(url) as conn:
        conn.execute(
            """INSERT INTO account(id, username, password_hash) VALUES (%s, 'fictional_host', %s)
            ON CONFLICT (id) DO NOTHING""",
            (owner, "!login-disabled"),
        )
        for title, address, latitude, longitude, price in SPACES:
            conn.execute(
                """INSERT INTO listing(id, owner_id, title, address, location, hourly_price_cents)
                VALUES (%s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s),4326)::geography, %s)
                ON CONFLICT (id) DO NOTHING""",
                (uuid5(owner, title), owner, title, address, longitude, latitude, price),
            )


if __name__ == "__main__":
    seed(os.environ["DATABASE_URL"])
    print("Fictional Chicago spaces are ready. Register your own account in the app.")
