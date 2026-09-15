"""Apply ordered SQL migrations once, verifying already-applied checksums."""

import hashlib
import os
from pathlib import Path

import psycopg

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"


def migrate(url: str, directory: Path = MIGRATIONS) -> None:
    with psycopg.connect(url) as conn:
        # Migration runners serialize; the entire upgrade is one transaction.
        conn.execute("SELECT pg_advisory_xact_lock(71024001)")
        conn.execute("""CREATE TABLE IF NOT EXISTS schema_migration (
            name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
        for path in sorted(directory.glob("*.sql")):
            sql = path.read_bytes()
            digest = hashlib.sha256(sql).hexdigest()
            previous = conn.execute(
                "SELECT sha256 FROM schema_migration WHERE name = %s", (path.name,)
            ).fetchone()
            if previous:
                if previous[0] != digest:
                    raise RuntimeError(f"Applied migration changed: {path.name}")
                continue
            conn.execute(sql.decode("utf-8"))
            conn.execute("INSERT INTO schema_migration(name, sha256) VALUES (%s, %s)", (path.name, digest))


if __name__ == "__main__":
    migrate(os.environ["DATABASE_URL"])
