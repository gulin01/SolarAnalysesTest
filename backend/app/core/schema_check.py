"""
Startup schema checks to ensure the database matches the SQLAlchemy models.
Runs on FastAPI startup; adds missing columns without breaking existing data.
Ensures analysis_jobs has: status, progress, progress_message, analysis_mode.
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection


async def ensure_analysis_mode_column(conn: AsyncConnection) -> None:
    """
    Ensure analysis_jobs.analysis_mode exists. Uses IF NOT EXISTS so safe to run
    every startup; existing rows get DEFAULT 'annual'.
    """
    table_result = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'analysis_jobs'"
        )
    )
    if table_result.scalar() is None:
        return
    # PostgreSQL 9.5+: add column only if missing (idempotent)
    await conn.execute(
        text("ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS analysis_mode VARCHAR DEFAULT 'annual'")
    )


async def run_startup_schema_checks(conn: AsyncConnection) -> None:
    """Run all startup schema checks. Call this from lifespan after create_all."""
    await ensure_analysis_mode_column(conn)
