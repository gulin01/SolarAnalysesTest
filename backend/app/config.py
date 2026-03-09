from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    app_name: str = "SolarSight API"
    debug: bool = False
    # SECRET_KEY MUST be set in production via env var. No default to prevent insecure deployments.
    secret_key: str = ""
    algorithm: str = "HS256"
    # Token expiration: 1 hour for security (refresh tokens implement longer-term sessions)
    access_token_expire_minutes: int = 60

    # Database
    database_url: str = ""

    # Redis / Celery
    redis_url: str = ""
    celery_broker_url: str = ""
    celery_result_backend: str = ""

    # MinIO / S3
    minio_endpoint: str = ""
    minio_access_key: str = ""
    minio_secret_key: str = ""
    minio_bucket: str = "solarsight"
    minio_secure: bool = True  # Default to HTTPS

    # CORS
    cors_origins: str = "http://localhost:3000"

    # Public API URL (for local storage: full URL to /api/models/{id}/download so frontend can load GLB)
    public_api_url: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Validate critical secrets in production
        if not self.debug:
            if not self.secret_key or self.secret_key == "change-me-in-production":
                raise ValueError(
                    "SECRET_KEY environment variable must be set to a strong random value in production. "
                    "Generate with: python -c 'import secrets; print(secrets.token_urlsafe(32))'"
                )
            if not self.database_url:
                raise ValueError("DATABASE_URL environment variable must be set in production")
            if not self.redis_url:
                raise ValueError("REDIS_URL environment variable must be set in production")
            if not self.minio_access_key or self.minio_access_key == "minioadmin":
                raise ValueError(
                    "MINIO_ACCESS_KEY must be set to a secure value in production (not 'minioadmin')"
                )
            if not self.minio_secret_key or self.minio_secret_key == "minioadmin":
                raise ValueError(
                    "MINIO_SECRET_KEY must be set to a secure value in production (not 'minioadmin')"
                )


@lru_cache
def get_settings() -> Settings:
    return Settings()
