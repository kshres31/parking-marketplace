"""Provision a fixed runtime role after migrations, using the database owner."""

import os

import psycopg
from psycopg import sql


def provision(url, password):
    if len(password) < 16:
        raise ValueError("APP_DATABASE_PASSWORD must have at least 16 characters")
    with psycopg.connect(url) as conn:
        conn.execute("SELECT pg_advisory_xact_lock(71024003)")
        if not conn.execute("SELECT 1 FROM pg_roles WHERE rolname = 'parking_app'").fetchone():
            conn.execute("CREATE ROLE parking_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION")
        conn.execute(sql.SQL("ALTER ROLE parking_app PASSWORD {}").format(sql.Literal(password)))
        conn.execute("REVOKE CREATE ON SCHEMA public FROM PUBLIC")
        conn.execute("GRANT USAGE ON SCHEMA public TO parking_app")
        conn.execute("""GRANT SELECT, INSERT, UPDATE, DELETE ON
            account, session, listing, booking, payment_event, refund_job, auth_limit TO parking_app""")


if __name__ == "__main__":
    provision(os.environ["DATABASE_URL"], os.environ["APP_DATABASE_PASSWORD"])
    print("Runtime grants applied; migration ownership stays separate.")
