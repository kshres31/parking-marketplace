from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from parking.app import Credentials, Interval, ListingInput, app, price_cents


def test_price_rounds_up_to_whole_cents_without_float_error():
    start = datetime(2030, 1, 1, tzinfo=UTC)
    assert price_cents(301, start, start + timedelta(minutes=30)) == 151
    assert price_cents(300, start, start + timedelta(hours=1)) == 300
    assert price_cents(1, start, start + timedelta(microseconds=1)) == 1


@pytest.mark.parametrize("minutes", [0, -1, 30 * 24 * 60 + 1])
def test_invalid_interval(minutes):
    start = datetime(2030, 1, 1, tzinfo=UTC)
    with pytest.raises(ValidationError):
        Interval(starts_at=start, ends_at=start + timedelta(minutes=minutes))


def test_timezone_is_required():
    with pytest.raises(ValidationError):
        Interval(starts_at="2030-01-01T10:00:00", ends_at="2030-01-01T11:00:00")


def test_plaintext_password_is_not_echoed_in_validation_errors():
    # Invalid body is rejected before any database dependency is needed.
    from parking.app import connection

    app.dependency_overrides[connection] = lambda: None
    try:
        response = TestClient(app).post("/auth/register", json={"username": "alice", "password": "secret"})
        assert response.status_code == 422
        assert "secret" not in response.text
    finally:
        app.dependency_overrides.clear()


def test_invalid_credentials_and_coordinates():
    with pytest.raises(ValidationError):
        Credentials(username="alice", password="short")
    with pytest.raises(ValidationError):
        ListingInput(title="Spot", address="Demo", latitude=float("nan"), longitude=0, hourly_price_cents=100)
