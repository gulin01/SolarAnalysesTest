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

        # Download or locate EPW file — use placement coordinates for the most
        # accurate PVGIS TMY download; fall back to station-only cache if missing.
        placement = project_data.get("placement") or {}
        epw_lat = placement.get("latitude")
        epw_lon = placement.get("longitude")
        epw_path = _get_epw_path(config["epw_station_id"], lat=epw_lat, lon=epw_lon)

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


def _get_epw_path(station_id: str, lat: float | None = None, lon: float | None = None) -> str:
    """
    Return local path to a real EPW/TMY weather file.

    Priority:
    1. Any *.epw file dropped in backend/data/ or the project root (for local testing).
    2. Per-location PVGIS download cached in /tmp/epw_cache/ (requires internet).
    3. Station-id-based cache path — solar engine falls back to synthetic if missing.
    """
    import httpx

    # 1. Check for manually placed EPW files in well-known locations.
    #    Prefers seoul.epw if present; otherwise takes the first .epw found.
    _backend_root = Path(__file__).parent.parent.parent  # backend/
    _search_dirs = [
        _backend_root / "data",
        _backend_root,
        Path.cwd(),
    ]
    for _dir in _search_dirs:
        _seoul = _dir / "seoul.epw"
        if _seoul.exists():
            logger.info("Using local seoul.epw: %s", _seoul)
            return str(_seoul)
        for _epw in sorted(_dir.glob("*.epw")):
            logger.info("Using local EPW file: %s", _epw)
            return str(_epw)

    # 2. PVGIS download (cached by lat/lon rounded to 2 decimal places ~ 1 km).
    cache_dir = Path("/tmp/epw_cache")
    cache_dir.mkdir(exist_ok=True)

    if lat is not None and lon is not None:
        cache_key = f"{round(lat, 2)}_{round(lon, 2)}"
        epw_file = cache_dir / f"{cache_key}.epw"
    else:
        epw_file = cache_dir / f"{station_id}.epw"

    if epw_file.exists():
        logger.info("EPW cache hit: %s", epw_file)
        return str(epw_file)

    if lat is None or lon is None:
        logger.warning(
            "No coordinates for EPW download (station=%s); analysis will use synthetic fallback",
            station_id,
        )
        return str(epw_file)

    pvgis_url = (
        f"https://re.jrc.ec.europa.eu/api/v5_2/tmy"
        f"?lat={lat}&lon={lon}&outputformat=epw&usehorizon=1"
    )
    logger.info("Downloading TMY EPW from PVGIS for (%.4f, %.4f) → %s", lat, lon, epw_file)
    try:
        with httpx.Client(timeout=60.0, follow_redirects=True) as client:
            resp = client.get(pvgis_url)
            resp.raise_for_status()
        epw_file.write_bytes(resp.content)
        logger.info("EPW saved (%d bytes): %s", len(resp.content), epw_file)
    except Exception as exc:
        logger.warning(
            "PVGIS EPW download failed for (%.4f, %.4f): %s — analysis will use synthetic fallback",
            lat, lon, exc,
        )

    return str(epw_file)
