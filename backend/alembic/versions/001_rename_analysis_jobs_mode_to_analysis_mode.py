"""rename analysis_jobs.mode to analysis_mode (PostgreSQL reserved word)

Revision ID: 001
Revises:
Create Date: 2025-03-05

PostgreSQL reserves 'mode' for ordered-set aggregate (WITHIN GROUP).
Renaming to analysis_mode avoids: WrongObjectTypeError: WITHIN GROUP is required.

Why "column analysis_mode does not exist" can happen:
1. Migration never ran against this DB (e.g. different DATABASE_URL, or run in another container).
2. App startup runs create_all() which does NOT alter existing tables; so old table with "mode" stays.
3. information_schema check used wrong schema (e.g. table in public, check missed it); rename was skipped.
4. Alembic marked revision 001 as applied but upgrade failed or was skipped (e.g. conditional was false).
5. Postgres data was recreated (new volume) after migration, then app started with old code and create_all created "mode" again.
"""
from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def _column_exists(connection, table: str, column: str) -> bool:
    # Explicit public schema; PostgreSQL lowercases unquoted identifiers in information_schema
    result = connection.execute(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = :t AND column_name = :c"
        ),
        {"t": table, "c": column},
    )
    return result.scalar() is not None


def upgrade() -> None:
    conn = op.get_bind()
    # Only rename if old column exists and new one does not (idempotent)
    if _column_exists(conn, "analysis_jobs", "mode") and not _column_exists(conn, "analysis_jobs", "analysis_mode"):
        # Raw SQL so the rename is unambiguous; op.alter_column can be dialect-sensitive
        op.execute("ALTER TABLE analysis_jobs RENAME COLUMN mode TO analysis_mode")


def downgrade() -> None:
    conn = op.get_bind()
    if _column_exists(conn, "analysis_jobs", "analysis_mode") and not _column_exists(conn, "analysis_jobs", "mode"):
        op.execute("ALTER TABLE analysis_jobs RENAME COLUMN analysis_mode TO mode")
