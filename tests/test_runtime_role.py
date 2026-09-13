import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.conninfo import make_conninfo
from psycopg.errors import InsufficientPrivilege

from parking.app import create_app
from scripts.provision_runtime import provision
from tests.test_api import account, interval, listing, reserve

pytestmark = pytest.mark.integration


def test_runtime_role_books_but_cannot_change_schema(client, database_url):
    password = "isolated-runtime-role-test-only"
    provision(database_url, password)
    runtime_url = make_conninfo(database_url, user="parking_app", password=password)
    with TestClient(create_app(runtime_url)) as runtime:
        owner, customer = account(runtime, "role_owner"), account(runtime, "role_customer")
        space = listing(runtime, owner)
        assert reserve(runtime, customer, space, interval()).status_code == 201
        assert (
            runtime.get(
                "/listings", params={**interval(), "latitude": 41.88, "longitude": -87.63}
            ).status_code
            == 200
        )
    with psycopg.connect(runtime_url, autocommit=True) as conn:
        with pytest.raises(InsufficientPrivilege):
            conn.execute("ALTER TABLE booking DROP CONSTRAINT no_overlapping_bookings")
        with pytest.raises(InsufficientPrivilege):
            conn.execute("DELETE FROM schema_migration")
