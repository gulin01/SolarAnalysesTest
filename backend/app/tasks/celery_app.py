from celery import Celery
from app.config import get_settings

settings = get_settings()

# API and worker must share the same CELERY_BROKER_URL and CELERY_RESULT_BACKEND
celery_app = Celery(
    "solarsight",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["app.tasks.analysis_task"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
)

# Ensure API and worker use same CELERY_BROKER_URL and CELERY_RESULT_BACKEND (and DATABASE_URL for DB updates)
