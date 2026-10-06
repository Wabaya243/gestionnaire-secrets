"""Versioned, additive migration for the existing SQLite/PostgreSQL database.
No drops, no rewriting vault ciphertext. Back up production before upgrading.
"""
from sqlalchemy import inspect, text
from sqlmodel import SQLModel
from app import models  # register every table

REVISION = "001_files_dashboards"


def migrate(engine):
    with engine.begin() as conn:
        if conn.dialect.name == "postgresql":
            # Serialize concurrent starts (transaction-scoped advisory lock).
            conn.execute(text("SELECT pg_advisory_xact_lock(781304291)"))
        conn.execute(text("CREATE TABLE IF NOT EXISTS schema_revision (revision VARCHAR(64) PRIMARY KEY)"))
        if conn.execute(text("SELECT revision FROM schema_revision WHERE revision=:r"), {"r": REVISION}).first():
            return
        inspector = inspect(conn)
        if "user" in inspector.get_table_names():
            existing = {c["name"] for c in inspector.get_columns("user")}
            additions = {
                "is_admin": "BOOLEAN NOT NULL DEFAULT FALSE",
                "is_active": "BOOLEAN NOT NULL DEFAULT TRUE",
                "session_version": "INTEGER NOT NULL DEFAULT 0",
                "last_login_at": "TIMESTAMP NULL",
            }
            for name, definition in additions.items():
                if name not in existing:
                    conn.execute(text(f'ALTER TABLE "user" ADD COLUMN {name} {definition}'))
        SQLModel.metadata.create_all(conn)
        conn.execute(text("INSERT INTO schema_revision (revision) VALUES (:r)"), {"r": REVISION})
