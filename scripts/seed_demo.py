"""Insert fictional Chicago listings once. No shared login or customer data."""

import os
from uuid import NAMESPACE_URL, uuid5

import psycopg

SPACES = [
    (
        "Riverwalk covered space",
        "Demo · River North",
        41.889,
        -87.630,
        450,
        "Covered bay two minutes from the Riverwalk.",
        ["covered", "security"],
    ),
    (
        "The Loop courtyard",
        "Demo · The Loop",
        41.882,
        -87.629,
        350,
        "Open courtyard space with step-free access to the street.",
        ["accessible"],
    ),
    (
        "West Loop garage",
        "Demo · West Loop",
        41.880,
        -87.643,
        500,
        "Attended garage with a Level 2 charger.",
        ["covered", "ev_charging", "security"],
    ),
    ("Printer’s Row parking", "Demo · South Loop", 41.873, -87.629, 275, "Quiet side-street driveway.", []),
    (
        "Lakeside open-air space",
        "Demo · Near Grant Park",
        41.878,
        -87.623,
        600,
        "Wide space that fits vans and pickups.",
        ["oversize"],
    ),
    (
        "Fulton corner space",
        "Demo · Fulton Market",
        41.886,
        -87.651,
        400,
        "Gated lot with camera coverage.",
        ["security"],
    ),
]


def seed(url):
    if os.getenv("PAYMENTS_MODE", "demo") != "demo":
        raise RuntimeError("Demo seeding is only available in demo mode")
    owner = uuid5(NAMESPACE_URL, "parkside:fictional-owner")
    with psycopg.connect(url) as conn:
        conn.execute(
            """INSERT INTO account(id, username, password_hash, role)
            VALUES (%s, 'fictional_host', %s, 'owner')
            ON CONFLICT (id) DO NOTHING""",
            (owner, "!login-disabled"),
        )
        for title, address, latitude, longitude, price, description, features in SPACES:
            conn.execute(
                """INSERT INTO listing(id, owner_id, title, address, location, hourly_price_cents,
                                       description, features)
                VALUES (%s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s),4326)::geography, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING""",
                (
                    uuid5(owner, title),
                    owner,
                    title,
                    address,
                    longitude,
                    latitude,
                    price,
                    description,
                    features,
                ),
            )


if __name__ == "__main__":
    seed(os.environ["DATABASE_URL"])
    print("Fictional Chicago spaces are ready. Register your own account in the app.")
