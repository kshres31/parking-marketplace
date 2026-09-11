import os
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg import sql
from psycopg.conninfo import make_conninfo

from parking.app import create_app
from parking.migrate import migrate


@pytest.fixture(scope="session")
def database_url():
    admin_url = os.getenv("TEST_DATABASE_URL")
    if not admin_url:
        pytest.skip("TEST_DATABASE_URL is required for real PostGIS integration tests")
    # Never drop or reset the supplied database: create our own uniquely named database.
    name = "parking_test_" + uuid4().hex
    with psycopg.connect(admin_url, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(sql.Identifier(name)))
    url = make_conninfo(admin_url, dbname=name)
    try:
        migrate(url)
        migrate(url)  # Repeat startup must not apply the migration again.
        yield url
    finally:
        with psycopg.connect(admin_url, autocommit=True) as admin:
            admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))


@pytest.fixture
def client(database_url):
    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute("TRUNCATE booking, listing, session, account CASCADE")
    with TestClient(create_app(database_url)) as test_client:
        yield test_client
