"""Serve the built UI and real API using a disposable PostGIS database."""

import os
from uuid import uuid4

import psycopg
import uvicorn
from psycopg import sql
from psycopg.conninfo import make_conninfo

from parking.app import create_app
from parking.migrate import migrate
from scripts.seed_demo import seed

if __name__ == "__main__":
    admin_url = os.environ["TEST_DATABASE_URL"]
    name = "parking_e2e_" + uuid4().hex
    with psycopg.connect(admin_url, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(sql.Identifier(name)))
    try:
        url = make_conninfo(admin_url, dbname=name)
        os.environ.update(PAYMENTS_MODE="demo", COOKIE_SECURE="0", PUBLIC_URL="http://127.0.0.1:8011")
        migrate(url)
        seed(url)
        uvicorn.run(create_app(url), host="127.0.0.1", port=8011)
    finally:
        with psycopg.connect(admin_url, autocommit=True) as admin:
            admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
