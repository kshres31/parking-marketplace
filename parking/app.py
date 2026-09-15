import hashlib
import os
import secrets
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from decimal import ROUND_CEILING, Decimal
from pathlib import Path
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from psycopg import Connection
from psycopg.errors import ExclusionViolation, UniqueViolation
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from pwdlib import PasswordHash
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from parking import payments

passwords = PasswordHash.recommended()
dummy_hash = passwords.hash("non-account timing equalizer")
bearer = HTTPBearer(auto_error=False)


class Credentials(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    username: str = Field(pattern=r"^[a-z][a-z0-9_-]{2,39}$")
    password: str = Field(min_length=12, max_length=128)


class ListingInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=3, max_length=120)
    address: str = Field(min_length=3, max_length=250)
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    hourly_price_cents: int = Field(ge=1, le=100000, strict=True)


class Interval(BaseModel):
    starts_at: AwareDatetime
    ends_at: AwareDatetime

    @model_validator(mode="after")
    def valid_interval(self):
        self.starts_at = self.starts_at.astimezone(UTC)
        self.ends_at = self.ends_at.astimezone(UTC)
        if not timedelta(0) < self.ends_at - self.starts_at <= timedelta(days=30):
            raise ValueError("Booking interval must be positive and at most 30 days")
        return self


class BookingInput(Interval):
    model_config = ConfigDict(extra="forbid")
    listing_id: UUID


class SearchInput(Interval):
    model_config = ConfigDict(extra="forbid")
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    radius_m: int = Field(default=5000, ge=100, le=50000)
    limit: int = Field(default=50, ge=1, le=100)


class ListingStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    active: bool = Field(strict=True)


def price_cents(hourly: int, starts: datetime, ends: datetime) -> int:
    elapsed = ends.astimezone(UTC) - starts.astimezone(UTC)
    microseconds = (elapsed.days * 86400 + elapsed.seconds) * 1_000_000 + elapsed.microseconds
    return int((Decimal(hourly) * microseconds / 3_600_000_000).to_integral_value(rounding=ROUND_CEILING))


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def connection(request: Request):
    with request.app.state.pool.connection() as conn:
        yield conn


DB = Annotated[Connection, Depends(connection)]


def current_user(
    request: Request, conn: DB, auth: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]
):
    token = auth.credentials if auth else request.cookies.get("parking_session", "")
    if not token or len(token) > 256:
        raise HTTPException(401, "Sign in required", headers={"WWW-Authenticate": "Bearer"})
    user = conn.execute(
        """SELECT a.id, a.username FROM account a JOIN session s ON s.account_id = a.id
        WHERE s.token_hash = %s AND s.expires_at > now()""",
        (token_hash(token),),
    ).fetchone()
    if not user:
        raise HTTPException(401, "Session expired or invalid", headers={"WWW-Authenticate": "Bearer"})
    return user


User = Annotated[dict, Depends(current_user)]


def issue_session(conn, user):
    token = secrets.token_urlsafe(32)
    expires = datetime.now(UTC) + timedelta(hours=12)
    conn.execute("INSERT INTO session VALUES (%s, %s, %s)", (token_hash(token), user["id"], expires))
    return {"access_token": token, "token_type": "bearer", "expires_at": expires, "user": user}


def auth_limit(conn, request):
    identity = request.client.host if request.client else "unknown"
    bucket = hashlib.sha256(identity.encode()).hexdigest()
    row = conn.execute(
        """INSERT INTO auth_limit(bucket) VALUES (%s)
        ON CONFLICT (bucket) DO UPDATE SET
          attempts = CASE WHEN auth_limit.window_start < now() - interval '10 minutes'
                          THEN 1 ELSE auth_limit.attempts + 1 END,
          window_start = CASE WHEN auth_limit.window_start < now() - interval '10 minutes'
                              THEN now() ELSE auth_limit.window_start END
        RETURNING attempts""",
        (bucket,),
    ).fetchone()
    if row["attempts"] > int(os.getenv("AUTH_RATE_LIMIT", "30")):
        raise HTTPException(
            429, "Too many sign-in attempts. Try again in 10 minutes.", headers={"Retry-After": "600"}
        )


def browser_session(result, request, response):
    if request.headers.get("X-Browser-Session") == "1":
        response.set_cookie(
            "parking_session",
            result["access_token"],
            httponly=True,
            secure=os.getenv("COOKIE_SECURE", "0") == "1",
            samesite="lax",
            max_age=43200,
            path="/",
        )
        return {"user": result["user"], "expires_at": result["expires_at"]}
    return result


def create_app(database_url: str | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app):
        payments.validate_settings()
        url = database_url or os.environ["DATABASE_URL"]
        with ConnectionPool(
            url,
            min_size=1,
            max_size=12,
            timeout=5,
            kwargs={
                "autocommit": True,
                "row_factory": dict_row,
                "application_name": "parking-api",
                "options": "-c statement_timeout=10000 -c lock_timeout=5000",
            },
        ) as pool:
            pool.wait(timeout=10)
            app.state.pool = pool
            yield

    app = FastAPI(title="Parking Marketplace API", version="0.1.0", lifespan=lifespan)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Default validation responses can echo the submitted password.
        errors = [
            {key: value for key, value in error.items() if key in {"loc", "msg", "type"}}
            for error in exc.errors()
        ]
        return JSONResponse(status_code=422, content={"detail": errors})

    @app.middleware("http")
    async def security_headers(request, call_next):
        if request.method not in {"GET", "HEAD", "OPTIONS"} and request.url.path != "/payments/webhook":
            origin = request.headers.get("origin")
            allowed = os.getenv("PUBLIC_URL", str(request.base_url)).rstrip("/")
            browser_request = request.headers.get("X-Browser-Session") == "1" or (
                "parking_session" in request.cookies and "authorization" not in request.headers
            )
            if (origin and origin != allowed) or (browser_request and origin != allowed):
                return JSONResponse(status_code=403, content={"detail": "Request origin is not allowed"})
        if request.method in {"POST", "PUT", "PATCH"}:
            content = bytearray()
            async for chunk in request.stream():
                content.extend(chunk)
                if len(content) > 65536:
                    return JSONResponse(status_code=413, content={"detail": "Request is too large"})
            request._body = bytes(content)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-Frame-Options"] = "DENY"
        return response

    @app.get("/config")
    def config():
        return {"payments_mode": payments.mode()}

    @app.get("/health")
    def health(conn: DB):
        conn.execute("SELECT 1")
        return {"status": "ok"}

    @app.post("/auth/register", status_code=201)
    def register(body: Credentials, conn: DB, request: Request, response: Response):
        auth_limit(conn, request)
        hashed = passwords.hash(body.password)
        user = {"id": uuid4(), "username": body.username}
        try:
            with conn.transaction():
                conn.execute(
                    "INSERT INTO account(id, username, password_hash) VALUES (%s, %s, %s)",
                    (user["id"], user["username"], hashed),
                )
                result = issue_session(conn, user)
            return browser_session(result, request, response)
        except UniqueViolation:
            raise HTTPException(409, "Username already exists") from None

    @app.post("/auth/login")
    def login(body: Credentials, conn: DB, request: Request, response: Response):
        auth_limit(conn, request)
        account = conn.execute("SELECT * FROM account WHERE username = %s", (body.username,)).fetchone()
        usable = account and not account["password_hash"].startswith("!")
        correct = passwords.verify(body.password, account["password_hash"] if usable else dummy_hash)
        if not usable or not correct:
            raise HTTPException(401, "Invalid username or password")
        with conn.transaction():
            result = issue_session(conn, {"id": account["id"], "username": account["username"]})
        return browser_session(result, request, response)

    @app.post("/auth/logout", status_code=204)
    def logout(
        user: User,
        conn: DB,
        request: Request,
        auth: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    ):
        token = auth.credentials if auth else request.cookies.get("parking_session", "")
        conn.execute("DELETE FROM session WHERE token_hash = %s", (token_hash(token),))
        response = Response(status_code=204)
        response.delete_cookie("parking_session", path="/")
        return response

    @app.get("/me")
    def me(user: User):
        return user

    @app.get("/host/listings")
    def host_listings(user: User, conn: DB):
        return conn.execute(
            """SELECT id, title, address, hourly_price_cents, active,
            ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude
            FROM listing WHERE owner_id = %s ORDER BY created_at DESC LIMIT 100""",
            (user["id"],),
        ).fetchall()

    @app.get("/host/bookings")
    def host_bookings(user: User, conn: DB):
        return conn.execute(
            """SELECT b.id, b.starts_at, b.ends_at, b.status, b.payment_status,
            b.total_price_cents, l.title, a.username AS customer
            FROM booking b JOIN listing l ON l.id = b.listing_id JOIN account a ON a.id = b.customer_id
            WHERE l.owner_id = %s ORDER BY b.starts_at DESC LIMIT 100""",
            (user["id"],),
        ).fetchall()

    @app.post("/listings", status_code=201)
    def add_listing(body: ListingInput, user: User, conn: DB):
        with conn.transaction():
            row = conn.execute(
                """INSERT INTO listing(id, owner_id, title, address, location, hourly_price_cents)
                VALUES (%s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s)
                RETURNING id, owner_id, title, address, hourly_price_cents, active""",
                (
                    uuid4(),
                    user["id"],
                    body.title,
                    body.address,
                    body.longitude,
                    body.latitude,
                    body.hourly_price_cents,
                ),
            ).fetchone()
        return row

    @app.patch("/listings/{listing_id}")
    def set_listing_status(listing_id: UUID, body: ListingStatus, user: User, conn: DB):
        with conn.transaction():
            row = conn.execute(
                "UPDATE listing SET active = %s WHERE id = %s AND owner_id = %s RETURNING id, active",
                (body.active, listing_id, user["id"]),
            ).fetchone()
            if not row:
                raise HTTPException(404, "Listing not found")
        return row

    @app.get("/listings")
    def search(conn: DB, query: Annotated[SearchInput, Query()]):
        return conn.execute(
            """WITH origin AS (
                SELECT ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography AS point)
            SELECT l.id, l.title, l.address, l.hourly_price_cents,
                   ST_Y(l.location::geometry) AS latitude, ST_X(l.location::geometry) AS longitude,
                   round(ST_Distance(l.location, o.point)::numeric, 1) AS distance_m
            FROM listing l CROSS JOIN origin o
            WHERE l.active AND ST_DWithin(l.location, o.point, %s)
              AND NOT EXISTS (SELECT 1 FROM booking b WHERE b.listing_id = l.id
                  AND (b.status = 'confirmed' OR (b.status = 'held' AND b.hold_expires_at > now()))
                  AND tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(%s, %s, '[)'))
            ORDER BY distance_m, l.id LIMIT %s""",
            (query.longitude, query.latitude, query.radius_m, query.starts_at, query.ends_at, query.limit),
        ).fetchall()

    @app.post("/bookings", status_code=201)
    def reserve(
        body: BookingInput,
        user: User,
        conn: DB,
        response: Response,
        request_id: Annotated[UUID, Header(alias="Idempotency-Key")],
    ):
        try:
            with conn.transaction():
                # Serialize a customer's keys before checking them, including across different listings.
                conn.execute("SELECT id FROM account WHERE id = %s FOR UPDATE", (user["id"],))
                prior = conn.execute(
                    "SELECT * FROM booking WHERE customer_id = %s AND request_id = %s",
                    (user["id"], request_id),
                ).fetchone()
                if prior:
                    if (prior["listing_id"], prior["starts_at"], prior["ends_at"]) != (
                        body.listing_id,
                        body.starts_at,
                        body.ends_at,
                    ):
                        raise HTTPException(
                            409, "Idempotency key already used with different booking details"
                        )
                    response.status_code = 200
                    return prior
                if body.starts_at <= datetime.now(UTC):
                    raise HTTPException(422, "Booking must start in the future")
                listing = conn.execute(
                    "SELECT * FROM listing WHERE id = %s FOR SHARE", (body.listing_id,)
                ).fetchone()
                if not listing or not listing["active"]:
                    raise HTTPException(404, "Listing not found")
                if listing["owner_id"] == user["id"]:
                    raise HTTPException(403, "You cannot reserve your own listing")
                payments.expire_holds(conn, body.listing_id)
                total = price_cents(listing["hourly_price_cents"], body.starts_at, body.ends_at)
                is_paid = payments.mode() == "stripe_test"
                if is_paid and (total < 50 or body.starts_at < datetime.now(UTC) + timedelta(minutes=40)):
                    raise HTTPException(
                        422, "Test checkout requires at least $0.50 and a start 40 minutes away"
                    )
                row = conn.execute(
                    """INSERT INTO booking
                    (id, customer_id, listing_id, request_id, starts_at, ends_at, total_price_cents,
                     status, payment_status, hold_expires_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
                    (
                        uuid4(),
                        user["id"],
                        body.listing_id,
                        request_id,
                        body.starts_at,
                        body.ends_at,
                        total,
                        "held" if is_paid else "confirmed",
                        "unpaid" if is_paid else "demo",
                        datetime.now(UTC) + timedelta(minutes=35) if is_paid else None,
                    ),
                ).fetchone()
            return row
        except ExclusionViolation:
            raise HTTPException(409, "This parking space is already reserved for that time") from None

    @app.get("/bookings")
    def my_bookings(
        user: User,
        conn: DB,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        offset: Annotated[int, Query(ge=0, le=10000)] = 0,
    ):
        return conn.execute(
            """SELECT b.*, l.title, l.address FROM booking b JOIN listing l ON l.id = b.listing_id
            WHERE b.customer_id = %s ORDER BY b.created_at DESC, b.id LIMIT %s OFFSET %s""",
            (user["id"], limit, offset),
        ).fetchall()

    @app.post("/bookings/{booking_id}/cancel")
    def cancel(booking_id: UUID, user: User, conn: DB):
        with conn.transaction():
            booking = conn.execute(
                "SELECT * FROM booking WHERE id = %s AND customer_id = %s FOR UPDATE",
                (booking_id, user["id"]),
            ).fetchone()
            if not booking:
                raise HTTPException(404, "Booking not found")
            if booking["status"] in {"held", "confirmed"}:
                if booking["starts_at"] <= datetime.now(UTC):
                    raise HTTPException(409, "A started booking cannot be cancelled")
                booking = conn.execute(
                    """UPDATE booking SET status = 'cancelled', cancelled_at = now()
                    WHERE id = %s RETURNING *""",
                    (booking_id,),
                ).fetchone()
                if booking["payment_status"] == "paid":
                    payments.queue_refund(conn, booking, booking["payment_intent"])
                    booking["payment_status"] = "refund_pending"
        return booking

    @app.post("/bookings/{booking_id}/checkout")
    def start_checkout(booking_id: UUID, user: User, conn: DB):
        return payments.checkout(conn, booking_id, user["id"])

    @app.post("/payments/webhook")
    async def webhook(request: Request):
        event = payments.signed_event(await request.body(), request.headers.get("stripe-signature", ""))
        # Offload synchronous database processing, avoiding event-loop blocking.
        from starlette.concurrency import run_in_threadpool

        def process():
            with request.app.state.pool.connection() as conn:
                payments.process_event(conn, event)

        await run_in_threadpool(process)
        return {"received": True}

    public = Path(os.getenv("FRONTEND_DIR", Path(__file__).resolve().parents[1] / "frontend" / "out"))
    if (public / "index.html").exists():
        app.mount("/", StaticFiles(directory=public, html=True), name="web")

    return app


app = create_app()
