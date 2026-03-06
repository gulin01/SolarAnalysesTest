"""
Local filesystem storage for development (replaces MinIO).
All paths are relative to the backend project root; files live under storage/.
"""
from pathlib import Path

# Backend project root (backend/)
_BASE_DIR = Path(__file__).resolve().parent.parent.parent


def _full_path(path: str) -> Path:
    """Resolve a stored path (e.g. storage/{project_id}/model.glb) to an absolute path."""
    return _BASE_DIR / path


def upload_bytes(object_name: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    """Write bytes to a file under storage/. Creates parent directories if needed."""
    full = _full_path(object_name)
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(data)
    return object_name


def download_bytes(object_name: str) -> bytes:
    """Read file from storage/."""
    full = _full_path(object_name)
    return full.read_bytes()


def delete_object(object_name: str) -> None:
    """Remove a file. No-op if it does not exist."""
    full = _full_path(object_name)
    if full.is_file():
        full.unlink()


def get_presigned_url(object_name: str, expires_seconds: int = 3600) -> str:
    """Local storage has no presigned URLs; raise so callers use the download endpoint."""
    raise NotImplementedError("Use /api/models/{id}/download for local storage")
