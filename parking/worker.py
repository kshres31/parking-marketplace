"""Run hold/session cleanup and retryable refunds. Start alongside the API."""

import logging
import os
import time

import psycopg
from psycopg.rows import dict_row

from parking.payments import expire_holds, mode, process_refunds, validate_settings


def tick(conn):
    expire_holds(conn)
    conn.execute("DELETE FROM session WHERE expires_at < now()")
    conn.execute("DELETE FROM auth_limit WHERE window_start < now() - interval '1 hour'")
    if mode() == "stripe_test":
        process_refunds(conn)


if __name__ == "__main__":
    validate_settings()
    while True:
        try:
            with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True, row_factory=dict_row) as conn:
                tick(conn)
        except Exception:
            logging.error("Maintenance cycle failed; retrying in 5 seconds")
        time.sleep(5)
