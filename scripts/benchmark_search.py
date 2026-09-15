"""Repeatable SQL radius-query measurement on a new disposable PostGIS database.

This measures database round trips on one connection, not HTTP throughput or production capacity.
"""

import json
import math
import os
import platform
import statistics
import time
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo

from parking.migrate import migrate

QUERY = """
SELECT id FROM listing
WHERE active AND ST_DWithin(location,
    ST_SetSRID(ST_MakePoint(-87.63, 41.88), 4326)::geography, 1000)
ORDER BY id LIMIT 100
"""


def run() -> dict:
    admin_url = os.environ["TEST_DATABASE_URL"]
    name = "parking_benchmark_" + uuid4().hex
    with psycopg.connect(admin_url, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(sql.Identifier(name)))
    try:
        url = make_conninfo(admin_url, dbname=name)
        migrate(url)
        with psycopg.connect(url, autocommit=True) as conn:
            owner = uuid4()
            conn.execute(
                "INSERT INTO account(id, username, password_hash) VALUES (%s, 'benchmark', 'no-login')",
                (owner,),
            )
            conn.execute(
                """INSERT INTO listing(id, owner_id, title, address, location, hourly_price_cents)
                SELECT md5(i::text)::uuid, %s, 'Synthetic space ' || i, 'Synthetic benchmark location',
                    ST_SetSRID(ST_MakePoint(-87.76 + (i %% 100) * 0.002,
                                           41.78 + (i / 100) * 0.002), 4326)::geography, 300
                FROM generate_series(0, 9999) i""",
                (owner,),
            )
            conn.execute("ANALYZE listing")
            expected = len(conn.execute(QUERY).fetchall())
            for _ in range(20):
                assert len(conn.execute(QUERY).fetchall()) == expected
            samples = []
            for _ in range(100):
                start = time.perf_counter_ns()
                rows = conn.execute(QUERY).fetchall()
                samples.append((time.perf_counter_ns() - start) / 1_000_000)
                assert len(rows) == expected
            plan = conn.execute("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + QUERY).fetchone()[0]
            ordered = sorted(samples)
            return {
                "kind": "single-connection SQL round trip; not an HTTP/load benchmark",
                "checkout_sha": os.getenv("GITHUB_SHA", "local-unrecorded"),
                "source_sha": os.getenv("SOURCE_COMMIT", "local-unrecorded"),
                "environment": {
                    "os": platform.system(),
                    "machine": platform.machine(),
                    "python": platform.python_version(),
                    "cpu_count": os.cpu_count(),
                },
                "postgres": conn.execute("SELECT version()").fetchone()[0],
                "postgis": conn.execute("SELECT postgis_full_version()").fetchone()[0],
                "dataset": {
                    "rows": 10000,
                    "grid": "100x100; 0.002 degree spacing",
                    "origin": [-87.76, 41.78],
                    "bookings": 0,
                },
                "workload": {
                    "query_center": [-87.63, 41.88],
                    "radius_m": 1000,
                    "warmup": 20,
                    "samples": 100,
                    "connections": 1,
                    "result_count": expected,
                },
                "latency_ms": {
                    "p50": statistics.median(samples),
                    "p95": ordered[math.ceil(0.95 * len(samples)) - 1],
                    "p99": ordered[math.ceil(0.99 * len(samples)) - 1],
                },
                "errors": 0,
                "samples_ms": samples,
                "query": QUERY,
                "explain": plan,
            }
    finally:
        with psycopg.connect(admin_url, autocommit=True) as admin:
            admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))


if __name__ == "__main__":
    result = run()
    Path("evidence").mkdir(exist_ok=True)
    Path("evidence/search.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {key: value for key, value in result.items() if key not in {"samples_ms", "explain"}}, indent=2
        )
    )
