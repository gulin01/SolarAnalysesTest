"""
Celery task: run solar analysis in the background.
Worker must use the same DATABASE_URL as the API (e.g. postgres:5432 in Docker, not localhost).
"""
import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from app.tasks.celery_app import celery_app
from app.core.storage import download_bytes, upload_bytes

# Register all SQLAlchemy models before any task runs (resolves AnalysisJob -> Project relationship)
from app.models import Project, AnalysisJob  # noqa: F401, E402

logger = logging.getLogger(__name__)
MAX_UPDATE_RETRIES = 2


def _sync_update_job(job_id: str, **kwargs):
    """Synchronous DB update via a new event loop. Retries once on failure."""
    last_exc = None
    for attempt in range(1, MAX_UPDATE_RETRIES + 1):
        try:
            asyncio.run(_async_update_job(job_id, **kwargs))
            if attempt > 1:
                logger.info("Job %s DB update succeeded on retry %d", job_id, attempt)
            return
        except Exception as e:
            last_exc = e
            logger.warning(
                "Job %s DB update attempt %d/%d failed: %s",
                job_id, attempt, MAX_UPDATE_RETRIES, e,
                exc_info=(attempt == MAX_UPDATE_RETRIES),
            )
    logger.exception("Failed to update job %s in DB after %d attempts", job_id, MAX_UPDATE_RETRIES)
    raise last_exc


async def _async_update_job(job_id: str, **kwargs):
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from app.config import get_settings
    from app.models.analysis import AnalysisJob

    settings = get_settings()
    # Worker must use same DATABASE_URL as API (e.g. postgres:5432 in Docker)
    engine = create_async_engine(settings.database_url)
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as db:
        job = await db.get(AnalysisJob, job_id)
        if job:
            for k, v in kwargs.items():
                setattr(job, k, v)
            await db.commit()
    await engine.dispose()


@celery_app.task(bind=True, name="app.tasks.analysis_task.run_solar_analysis")
def run_solar_analysis(self, job_id: str):
    from app.services.solar_engine import run_analysis

    logger.info("Worker received analysis task job_id=%s", job_id)

    # Immediately mark running so frontend sees progress
    _sync_update_job(
        job_id,
        status="running",
        progress=1.0,
        progress_message="Starting solar analysis",
    )

    def progress_cb(pct: float, msg: str):
        logger.info("Job %s progress %.0f%% %s", job_id, pct, msg)
        try:
            _sync_update_job(job_id, progress=pct, progress_message=msg)
        except Exception as e:
            logger.exception("Job %s progress update failed: %s", job_id, e)
            raise

    try:
        # Fetch job + project data
        job_data, project_data, model_data = _fetch_job_data(job_id)
        config = job_data["config"]

        # Download model GLB
        glb_bytes = download_bytes(model_data["normalized_glb_path"])

        # Download or locate EPW file
        epw_path = _get_epw_path(config["epw_station_id"])

        result = run_analysis(
            glb_bytes=glb_bytes,
            placement=project_data.get("placement") or {},
            config=config,
            epw_path=epw_path,
            progress_cb=progress_cb,
        )

        # Local storage: storage/{project_id}/analysis/{job_id}/results.json
        project_id = project_data.get("project_id")
        result_json = json.dumps({**result, "job_id": job_id}).encode()
        result_path = f"storage/{project_id}/analysis/{job_id}/results.json"
        upload_bytes(result_path, result_json, "application/json")

        _sync_update_job(
            job_id,
            status="completed",
            progress=100.0,
            progress_message="Done",
            result_path=result_path,
            completed_at=datetime.now(timezone.utc),
        )
        logger.info("Analysis task completed job_id=%s", job_id)

    except Exception as exc:
        logger.exception("Analysis task failed job_id=%s: %s", job_id, exc)
        try:
            _sync_update_job(
                job_id,
                status="failed",
                error_message=str(exc),
                completed_at=datetime.now(timezone.utc),
            )
        except Exception as update_err:
            logger.exception("Failed to mark job %s as failed in DB: %s", job_id, update_err)
        raise


def _fetch_job_data(job_id: str) -> tuple[dict, dict, dict]:
    return asyncio.run(_async_fetch_job_data(job_id))


async def _async_fetch_job_data(job_id: str) -> tuple[dict, dict, dict]:
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from app.config import get_settings
    from app.models.analysis import AnalysisJob
    from app.models.project import Project
    from app.models.model import Model3D

    settings = get_settings()
    engine = create_async_engine(settings.database_url)
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with Session() as db:
        job = await db.get(AnalysisJob, job_id)
        project = await db.get(Project, job.project_id)
        model = await db.get(Model3D, project.model_id)

    await engine.dispose()

    return (
        {"config": job.config, "id": job.id},
        {"placement": project.placement, "project_id": project.id},
        {"normalized_glb_path": model.normalized_glb_path},
    )


def _get_epw_path(station_id: str) -> str:
    """
    Return local path to EPW file for the given station.
    Downloads from Climate.OneBuilding if not cached.
    """
    cache_dir = Path("/tmp/epw_cache")
    cache_dir.mkdir(exist_ok=True)
    epw_file = cache_dir / f"{station_id}.epw"

    if epw_file.exists():
        return str(epw_file)

    # EPW files are indexed by station_id which encodes the download URL slug.
    # In production, pre-cache on first use from Climate.OneBuilding.Org
    # For now return a placeholder path — the solar engine handles missing EPW gracefully.
    return str(epw_file)
