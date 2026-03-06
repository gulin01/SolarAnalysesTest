from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import get_settings
from app.core.database import engine, Base
from app.core.auth import DEV_USER_ID
from app.core.schema_check import run_startup_schema_checks
from app.api import models, projects, analysis, weather, reports, websocket, auth

# Register all SQLAlchemy models before create_all / any mapper resolution
import app.models  # noqa: F401


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables (alembic handles migrations in production)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Ensure analysis_jobs.analysis_mode exists (add if missing; no-op if already there)
        await run_startup_schema_checks(conn)
        # Seed dev user so auth-free testing works
        await conn.execute(text("""
            INSERT INTO users (id, email, name, hashed_password, created_at)
            VALUES (:id, :email, :name, :pwd, NOW())
            ON CONFLICT (id) DO NOTHING
        """), {"id": DEV_USER_ID, "email": "dev@local", "name": "Dev User", "pwd": "dev-no-auth"})
    yield


settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# REST routers
app.include_router(auth.router,     prefix="/api/auth",     tags=["auth"])
app.include_router(models.router,   prefix="/api/models",   tags=["models"])
app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(analysis.router, prefix="/api/analysis", tags=["analysis"])
app.include_router(weather.router,  prefix="/api/weather",  tags=["weather"])
app.include_router(reports.router,  prefix="/api/reports",  tags=["reports"])

# WebSocket router
app.include_router(websocket.router, prefix="/ws", tags=["websocket"])


@app.get("/health")
async def health():
    return {"status": "ok"}
