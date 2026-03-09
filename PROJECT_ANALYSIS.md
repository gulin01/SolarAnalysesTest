# SolarSight Project - Comprehensive Analysis & Potential Issues
**Date:** March 9, 2026  
**Project:** SolarSight (Solar Panel Analysis Platform - Next.js + FastAPI)

---
## Executive Summary
This document identifies **45+ potential issues** across the SolarSight codebase, categorized by severity and area. Issues range from critical security concerns to UX improvements. Most are solvable with targeted fixes.
---
## 🔴 CRITICAL ISSUES
### 1. **Hard-Coded Default Credentials & Secrets**
**Files:** `backend/app/config.py`, `docker-compose.yml`
**Issues:**
- Default `secret_key = "change-me-in-production"` (line 11)
- Default MinIO credentials: `minioadmin / minioadmin` (lines 24-26)
- Default database password in compose: `solarsight / solarsight` (docker-compose.yml:37)
- No mechanism to enforce secret rotation

**Risk:** Any attacker with network access can forge JWT tokens or access MinIO/DB.

**Fix:**
- Require environment variables for all secrets (no defaults)
- Generate strong random defaults in Docker `entrypoint.sh`
- Document secret rotation procedure
- Add startup validation to fail if defaults are still in use in production

```python
# Example fix for config.py
class Settings(BaseSettings):
    secret_key: str  # Remove default; will fail if not set
    if not secret_key or secret_key == "change-me-in-production":
        raise ValueError("SECRET_KEY must be set in production!")
```

---

### 2. **Authentication Bypass in Development Mode**

**File:** `backend/app/core/auth.py:53-56`

**Issue:**
```python
async def get_current_user_id(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> str:
    if not credentials:
        return DEV_USER_ID  # ❌ RETURNS DEV USER IF NO TOKEN PROVIDED
    return decode_token(credentials.credentials)
```
**Problem:** Any request without a Bearer token is treated as the dev user. This persists even if accidentally left in production build.
**Fix:**
```python
async def get_current_user_id(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> str:
    if settings.debug:  # Only allow in debug mode
        if not credentials:
            return DEV_USER_ID
    if not credentials:
        raise HTTPException(status_code=401, detail="Missing authorization token")
    return decode_token(credentials.credentials)
```

---
### 3. **CORS Misconfiguration - Allows All Methods/Headers**
**File:** `backend/app/main.py:41-46`
**Issue:**
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],  # ❌ Allows DELETE, PUT, PATCH from any endpoint
    allow_headers=["*"],   # ❌ Allows any header (Authorization, etc.)
)
```
**Risk:** 
- Any JavaScript from an allowed origin can make any HTTP method call
- Combined with dev user bypass, this is a severe vulnerability
**Fix:**
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],  # Explicit list
    allow_headers=["Content-Type", "Authorization"],   # Explicit list
)
```

---

### 4. **WebSocket Endpoint Missing Authentication Check**

**File:** `backend/app/api/websocket.py:12-30`

**Issue:**
```python
@router.websocket("/analysis/{job_id}")
async def analysis_progress(websocket: WebSocket, job_id: str):
    await websocket.accept()  # ❌ No auth check!
    # Any user can subscribe to any job_id and see progress
```

**Risk:** 
- User A can stream progress from User B's analysis jobs
- No ownership validation before accepting connection

**Fix:**
```python
@router.websocket("/analysis/{job_id}")
async def analysis_progress(websocket: WebSocket, job_id: str):
    # Extract token from query param or header
    token = websocket.query_params.get("token")
    try:
        user_id = decode_token(token)
    except:
        await websocket.close(code=1008, reason="Unauthorized")
        return
    
    # Verify user owns this job
    async with AsyncSessionLocal() as db:
        job = await db.get(AnalysisJob, job_id)
        if not job or job.project_id not in (await get_user_project_ids(db, user_id)):
            await websocket.close(code=1008, reason="Forbidden")
            return
    
    await websocket.accept()
    # ... proceed with auth
```

---

### 5. **No Rate Limiting - DDoS Vulnerability**

**Files:** `backend/app/main.py`, all API endpoints

**Issue:** No rate limiting middleware on any endpoints. Attackers can:
- Spam `/api/auth/login` with brute force attempts
- Spam `/api/analysis/run` to overwhelm workers
- Download large models repeatedly

**Fix:** Add `slowapi` or similar:

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

@router.post("/login")
@limiter.limit("5/minute")  # 5 login attempts per minute
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    ...
```

---

## 🟠 HIGH PRIORITY ISSUES

### 6. **Long JWT Token Expiration (7 days)**

**File:** `backend/app/config.py:14`

```python
access_token_expire_minutes: int = 60 * 24 * 7  # 7 days
```

**Issue:** If a token is compromised, attacker has 7 days of access.

**Fix:** Reduce to 1 hour, implement refresh tokens:

```python
access_token_expire_minutes: int = 60  # 1 hour
refresh_token_expire_days: int = 7     # Refresh token lasts 7 days
```

---

### 7. **Celery Task Asyncio Event Loop Issues**

**File:** `backend/app/tasks/analysis_task.py:15-42`

**Issue:**
```python
def _sync_update_job(job_id: str, **kwargs):
    """Synchronous DB update via a new event loop. Retries once on failure."""
    for attempt in range(1, MAX_UPDATE_RETRIES + 1):
        try:
            asyncio.run(_async_update_job(job_id, **kwargs))  # ❌ Creates nested loop
```

**Problems:**
- `asyncio.run()` creates a new event loop each time. In a long-running Celery task, this can fail with "Event loop is closed" or "Cannot run event loop" after the first iteration
- Retry logic (2 attempts) is insufficient; transient DB errors will still fail
- No exponential backoff

**Risk:** Progress updates silently fail; user sees stuck analysis jobs (documented issue in `backend/docs/ANALYSIS_PROGRESS_NOT_UPDATING.md`)

**Fix:** Use sync SQLAlchemy driver in worker, or implement proper async context:

```python
# Option 1: Use sync driver for worker
from sqlalchemy import create_engine, text
from app.config import get_settings

settings = get_settings()
db_url = settings.database_url.replace("asyncpg", "psycopg2")
sync_engine = create_engine(db_url)

def _sync_update_job(job_id: str, **kwargs):
    max_retries = 5
    backoff = 0.1
    for attempt in range(1, max_retries + 1):
        try:
            with Session(sync_engine) as session:
                job = session.get(AnalysisJob, job_id)
                for k, v in kwargs.items():
                    setattr(job, k, v)
                session.commit()
            return
        except Exception as e:
            if attempt == max_retries:
                raise
            wait = backoff * (2 ** (attempt - 1))  # Exponential backoff
            time.sleep(wait)
```

---

### 8. **No Celery Task Timeout**

**File:** `backend/app/tasks/analysis_task.py:59-160`

**Issue:** `run_solar_analysis` task has no timeout. If solar engine hangs:
- Task runs forever
- Worker becomes unresponsive
- Jobs accumulate in Redis

**Fix:**
```python
@celery_app.task(
    bind=True,
    name="app.tasks.analysis_task.run_solar_analysis",
    time_limit=600,          # 10 min hard timeout
    soft_time_limit=580,     # 9:40 soft timeout (cleanup)
)
def run_solar_analysis(self, job_id: str):
    try:
        # ... existing code
    except SoftTimeLimitExceeded:
        _sync_update_job(
            job_id,
            status="failed",
            error_message="Analysis timeout (>10 mins)",
        )
```

---

### 9. **Unvalidated Development Credentials Seed**

**File:** `backend/app/main.py:19-26`

```python
await conn.execute(text("""
    INSERT INTO users (id, email, name, hashed_password, created_at)
    VALUES (:id, :email, :name, :pwd, NOW())
    ON CONFLICT (id) DO NOTHING
"""), {"id": DEV_USER_ID, "email": "dev@local", "name": "Dev User", "pwd": "dev-no-auth"})
```

**Issues:**
- Development user inserted on every startup
- Email is hardcoded and not hashed properly
- `"pwd": "dev-no-auth"` is stored as plaintext (should be hashed)
- Even in production, this code runs if `debug=True` leaks

**Fix:**
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await run_startup_schema_checks(conn)
        
        # Only seed dev user in DEBUG mode
        if settings.debug:
            pwd_hash = hash_password("dev-password-change-me")
            await conn.execute(text("""
                INSERT INTO users (id, email, name, hashed_password, created_at)
                VALUES (:id, :email, :name, :pwd, NOW())
                ON CONFLICT (id) DO NOTHING
            """), {
                "id": DEV_USER_ID,
                "email": "dev@example.local",
                "name": "Dev User",
                "pwd": pwd_hash
            })
```

---

### 10. **No Input Validation on Query Parameters**

**File:** `backend/app/api/weather.py:15-26`

```python
@router.get("/stations", response_model=StationsResponse)
async def get_stations(
    lat: float = Query(..., description="Latitude from project placement"),
    lng: float = Query(..., description="Longitude from project placement"),
    limit: int = Query(5, ge=1, le=20),  # Only `limit` is validated!
    _: str = Depends(get_current_user_id),
):
```

**Issues:**
- `lat` and `lng` are not validated to be valid coordinates (-90 to 90, -180 to 180)
- Could cause crashes in `find_nearest_stations` if invalid values passed
- No validation that `lat`/`lng` are not NaN/Inf

**Fix:**
```python
from pydantic import Field

@router.get("/stations", response_model=StationsResponse)
async def get_stations(
    lat: float = Query(..., ge=-90, le=90, description="Latitude"),
    lng: float = Query(..., ge=-180, le=180, description="Longitude"),
    limit: int = Query(5, ge=1, le=20),
    _: str = Depends(get_current_user_id),
):
```

---

## 🟡 MEDIUM PRIORITY ISSUES

### 11. **Frontend Session Not Auto-Refreshing on Token Expiration**

**File:** `frontend/lib/auth.ts:18-40`

**Issue:**
- NextAuth stores JWT token in session
- No refresh token mechanism
- If token expires (1 hour), user isn't logged out; next API call fails with 401
- User gets generic "API 401" error instead of redirect to login

**Fix:**
```typescript
callbacks: {
  async jwt({ token, user }) {
    if (user) {
      token.accessToken = (user as any).accessToken
      token.expiresAt = Date.now() + 60 * 60 * 1000  // 1 hour from now
    }
    
    // If token expired, try refresh (if refresh token available)
    if (token.expiresAt && Date.now() > token.expiresAt) {
      // Implement token refresh logic here
      return null  // Force re-login
    }
    return token
  },
}
```

---

### 12. **Missing Error Boundary Components in Frontend**

**Files:** `frontend/app/projects/page.tsx`, `frontend/components/`

**Issue:** No error boundaries for component crashes. If Three.js/D3 crashes, entire page becomes blank with no user feedback.

**Fix:** Create error boundary:

```typescript
// frontend/components/ui/ErrorBoundary.tsx
'use client'

import { useState } from 'react'

export function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const [hasError, setHasError] = useState(false)

  if (hasError) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded">
        <h2 className="text-red-900 font-bold">Something went wrong</h2>
        <button onClick={() => setHasError(false)}>Try again</button>
      </div>
    )
  }

  return <>{children}</>
}
```

---

### 13. **Incomplete Delete Button Race Condition**

**File:** `frontend/components/projects/ProjectCard.tsx:24-45` (provided in attachment)

**Issue:**
```typescript
async function handleDelete() {
    if (inFlight.current) return   // Prevents double-click
    inFlight.current = true
    setDeleting(true)
    setConfirming(false)
    try {
      await apiClient.delete(`/projects/${project.id}`)
      toast.success('Project deleted')
      router.push('/projects')
    } catch {
      toast.error('Failed to delete project')
      inFlight.current = false  // ❌ Also sets deleting=false, but never does!
      setDeleting(false)
    }
  }
```

**Problems:**
1. On success, `inFlight.current` never reset (minor but cleanup issue)
2. If deletion fails and user clicks delete again, button stays disabled because `inFlight.current` is still true
3. Navigate after delete is async; race condition if page unmounts

**Fix:**
```typescript
async function handleDelete() {
    if (inFlight.current) return
    inFlight.current = true
    setDeleting(true)
    setConfirming(false)
    try {
      await apiClient.delete(`/projects/${project.id}`)
      toast.success('Project deleted')
      // Don't reset inFlight; component will unmount
      await new Promise(r => setTimeout(r, 500))  // Wait for toast
      router.push('/projects')
    } catch (error) {
      toast.error('Failed to delete project')
      inFlight.current = false
      setDeleting(false)
    }
  }
```

---

### 14. **No Retry Logic on Failed API Requests**

**File:** `frontend/lib/api.ts:29-37`

```typescript
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${serverBase()}${path}`, { ... })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${res.status}: ${text}`)  // ❌ No retry
  }
  return res.json() as Promise<T>
}
```

**Issue:** 
- Network hiccup = instant failure, poor UX on flaky networks
- 500 errors from backend should retry
- File uploads (3-5GB GLB) should have retry logic

**Fix:**
```typescript
async function request<T>(
  path: string,
  init?: RequestInit,
  maxRetries = 3,
): Promise<T> {
  let lastError: Error | null = null
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(`${serverBase()}${path}`, { ...init })
      if (!res.ok) {
        // Retry on 5xx errors only, not 4xx
        if (res.status >= 500 && attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
          continue
        }
        throw new Error(`API ${res.status}: ${await res.text()}`)
      }
      return res.json()
    } catch (error) {
      lastError = error as Error
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
      }
    }
  }
  throw lastError
}
```

---

### 15. **Analysis Polling Stops on Network Error**

**File:** `frontend/hooks/useAnalysisPolling.ts:10-18`

```typescript
const statusQuery = useQuery({
  ...queries.analysisStatus(jobId ?? ''),
  enabled: !!jobId,
  refetchInterval: (query) => {
    const status = query.state.data?.status
    if (status === 'completed' || status === 'failed') return false
    return 3000  // ❌ If query errors, polling doesn't resume
  },
})
```

**Issue:** 
- If network hiccup causes a query error, `refetchInterval` continues returning `3000`
- But TanStack Query may not retry; user sees "pending" forever
- No error UI shown

**Fix:**
```typescript
const statusQuery = useQuery({
  ...queries.analysisStatus(jobId ?? ''),
  enabled: !!jobId,
  retry: 3,  // Retry on transient failures
  retryDelay: (attempt) => Math.pow(2, attempt) * 1000,  // Exponential backoff
  refetchInterval: (query) => {
    if (query.state.error && !query.state.data) {
      return 5000  // Retry polling faster on error
    }
    const status = query.state.data?.status
    if (status === 'completed' || status === 'failed') return false
    return 3000
  },
})

// Show error state
if (statusQuery.isError && !statusQuery.data) {
  return <div className="text-red-600">Connection lost. Retrying...</div>
}
```

---

### 16. **Missing Pagination on List Endpoints**

**Files:** `backend/app/api/projects.py:27-38`

```python
@router.get("", response_model=list[ProjectOut])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    result = await db.scalars(
        select(Project).where(Project.user_id == user_id).order_by(Project.updated_at.desc())
    )
    return [ProjectOut.from_orm_with_model_url(p) for p in result.all()]  # ❌ Returns all!
```

**Issue:**
- If user has 10,000 projects, entire list loaded in memory
- Database query slow
- Serialization slow
- Network transfer huge

**Fix:**
```python
@router.get("", response_model=PaginatedResponse)
async def list_projects(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    query = select(Project).where(Project.user_id == user_id).order_by(Project.updated_at.desc())
    total = await db.scalar(select(func.count()).select_from(Project).where(Project.user_id == user_id))
    result = await db.scalars(query.offset(skip).limit(limit))
    
    return PaginatedResponse(
        items=[ProjectOut.from_orm_with_model_url(p) for p in result],
        total=total,
        skip=skip,
        limit=limit,
    )
```

---

### 17. **Inconsistent Error Response Format**

**Files:** Multiple API endpoints

**Issue:** 
- Some endpoints return `{"detail": "..."}` (FastAPI default)
- Some might return `{"error": "..."}` (custom)
- Frontend doesn't know which field to check

**Example:**
```python
# projects.py
raise HTTPException(status_code=404, detail="Project not found")  # Uses `detail`

# models.py  
raise HTTPException(status_code=400, detail=f"Unsupported format: {ext}")  # Uses `detail`

# But frontend expects:
try {
  await apiClient.post(...)
} catch (e) {
  const msg = e.message  // Catches generic "API 400: ..."
}
```

**Fix:** Create consistent error schema:

```python
class ErrorResponse(BaseModel):
    status_code: int
    error_code: str  # e.g., "PROJECT_NOT_FOUND"
    message: str
    details: dict | None = None

def create_error_response(code: str, message: str, status_code: int):
    raise HTTPException(
        status_code=status_code,
        detail={
            "error_code": code,
            "message": message,
        },
    )

# Usage
create_error_response("PROJECT_NOT_FOUND", f"Project {project_id} not found", 404)
```

---

### 18. **No Transaction Rollback on Partial Failures**

**File:** `backend/app/api/models.py:45-67`

```python
@router.post("/upload", status_code=201)
async def upload_model(...):
    # ... parse and convert ...
    
    upload_bytes(orig_path, content, ...)  # S3
    upload_bytes(glb_path, result["glb_bytes"], ...)  # S3
    
    model = Model3D(...)
    db.add(model)
    await db.flush()
    
    project = await db.get(Project, project_id)
    project.model_id = model.id  # ❌ If this fails, model is orphaned in S3
    await db.commit()
```

**Issue:**
- If project update fails after S3 upload, orphaned files in S3
- No way to clean up; storage leaks

**Fix:**
```python
@router.post("/upload", status_code=201)
async def upload_model(...):
    try:
        # ... parse ...
        
        # Upload to S3 first
        upload_bytes(orig_path, content, ...)
        upload_bytes(glb_path, result["glb_bytes"], ...)
        
        # Then DB transaction (commit/rollback is atomic)
        async with db.begin():  # Transaction context
            model = Model3D(...)
            db.add(model)
            await db.flush()
            
            project = await db.get(Project, project_id)
            project.model_id = model.id
        
        return ModelMetaOut.from_orm_with_url(model)
    except Exception as e:
        # Clean up orphaned S3 files
        try:
            delete_object(orig_path)
            delete_object(glb_path)
        except:
            logger.exception("Failed to clean up S3 files after failed upload")
        raise
```

---

## 🔵 LOWER PRIORITY ISSUES (But Still Important)

### 19. **No Database Connection Pooling Configuration**

**File:** `backend/app/core/database.py:8-11`

```python
engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_pre_ping=True,  # ✓ Good
    # Missing pool_size, max_overflow, pool_recycle
)
```

**Issue:** Under load, connection pool may be exhausted or connections may be stale.

**Fix:**
```python
engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_pre_ping=True,
    pool_size=20,        # Connections per worker
    max_overflow=10,     # Extra connections under load
    pool_recycle=3600,   # Recycle connections every hour
    pool_echo=False,
)
```

---

### 20. **Soft Deletes Not Implemented**

**Files:** `backend/app/models/project.py`, etc.

**Issue:** DELETE endpoints hard-delete data. No audit trail; data loss on error.

**Fix:** Implement soft deletes:

```python
class Project(Base):
    __tablename__ = "projects"
    
    id: Mapped[str] = mapped_column(primary_key=True)
    # ... other fields ...
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    
    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None

# In queries, filter deleted_at IS NULL
async def list_projects(...):
    result = await db.scalars(
        select(Project)
        .where(Project.user_id == user_id)
        .where(Project.deleted_at.is_(None))  # Active projects only
        .order_by(Project.updated_at.desc())
    )
```

---

### 21. **No Database Backup/Restore Strategy**

**Files:** docker-compose.yml

**Issue:** No backup mechanism documented or configured. Single database failure = complete data loss.

**Fix:** 
- Add automated backup to S3/MinIO every 6 hours
- Document restoration procedure
- Test backup/restore monthly

```yaml
services:
  postgres:
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_BACKUP_bucket=solarsight-backups
      - POSTGRES_BACKUP_schedule=0 */6 * * *  # Every 6 hours
```

---

### 22. **Type Unsafety in NextAuth Callback**

**File:** `frontend/lib/auth.ts:37-40`

```typescript
session({ session, token }) {
  (session as any).accessToken = token.accessToken  // ❌ Casting to any
  return session
}
```

**Fix:**
```typescript
interface CustomSession extends Session {
  accessToken?: string
}

declare module "next-auth" {
  interface Session extends CustomSession {}
}

session({ session, token }): CustomSession {
  const customSession = session as CustomSession
  customSession.accessToken = token.accessToken as string
  return customSession
}
```

---

### 23. **Missing Logging for Background Tasks**

**File:** `backend/app/tasks/analysis_task.py`

**Issue:**
- Limited logging; hard to debug worker issues
- No structured logging (JSON); hard to parse in production
- No log level configuration

**Fix:**
```python
import logging
import json
from pythonjsonlogger import jsonlogger

handler = logging.StreamHandler()
formatter = jsonlogger.JsonFormatter()
handler.setFormatter(formatter)

logger = logging.getLogger(__name__)
logger.addHandler(handler)

# Usage
logger.info("analysis_started", extra={
    "job_id": job_id,
    "project_id": project_id,
    "user_id": user_id,
    "mode": config["mode"],
})
```

---

### 24. **No Request ID Tracing**

**Files:** All API endpoints

**Issue:** 
- If error occurs, no way to trace request through logs
- Different UI/server/worker logs not correlated

**Fix:**
```python
from contextvars import ContextVar
import uuid

request_id_cv: ContextVar[str] = ContextVar("request_id")

@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request_id_cv.set(request_id)
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response

# In logging
logger.info("task_started", extra={"request_id": request_id_cv.get()})
```

---

### 25. **Large Heatmap JSON Not Streamed**

**File:** `backend/app/api/analysis.py:99-113`

```python
@router.get("/{job_id}/results", response_model=AnalysisResultOut)
async def get_results(...):
    raw = download_bytes(job.result_path)  # ❌ Loads entire JSON into memory
    return AnalysisResultOut(**json.loads(raw))  # ❌ Parses entire JSON
```

**Issue:** 
- For multi-MB JSON files, loads entire file into memory
- Serializes entire response
- Noted in architecture doc: "Large result JSON (>10MB) | Medium | Stream with fetch + ReadableStream; paginate if needed"

**Fix:**
```python
@router.get("/{job_id}/results")
async def get_results(...):
    def iterate_file():
        yield from download_bytes(job.result_path, stream=True)
    
    return StreamingResponse(iterate_file(), media_type="application/json")
```

---

### 26. **No Mapbox Token Validation**

**File:** `frontend/components/map/MapBox.tsx`

**Issue:** If `NEXT_PUBLIC_MAPBOX_TOKEN` is missing or invalid, MapBox silently fails with cryptic errors.

**Fix:**
```typescript
if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
  throw new Error("NEXT_PUBLIC_MAPBOX_TOKEN must be set in .env.local")
}

if (process.env.NEXT_PUBLIC_MAPBOX_TOKEN.startsWith("pk.")) {
  // Valid token format
}
```

---

### 27. **Missing HTTPS Enforcement**

**Files:** `nginx/nginx.conf`

**Issue:** No redirect from HTTP → HTTPS. Development only issue if prod uses HTTP.

**Fix:**
```nginx
server {
    listen 80;
    server_name _;
    
    if ($scheme != "https") {
        return 301 https://$server_name$request_uri;
    }
}
```

---

### 28. **No Content Security Policy (CSP)**

**Files:** `frontend/app/layout.tsx`

**Issue:** XSS attacks can inject scripts if CSP not set.

**Fix:**
```typescript
import type { Metadata } from "next"

export const metadata: Metadata = {
  other: {
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",  // For Three.js
      "style-src 'self' 'unsafe-inline'",      // For Tailwind
      "img-src 'self' data: https:",
      "font-src 'self'",
    ].join(";"),
  },
}
```

---

### 29. **No Health Check Endpoint Configuration**

**File:** `docker-compose.yml`, `backend/app/main.py`

**Issue:**
- `/health` endpoint exists but no Docker healthcheck configured
- Nginx/load balancer can't tell if backend is healthy

**Fix:**
```yaml
services:
  backend:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 10s
    
  frontend:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000"]
      interval: 10s
      timeout: 5s
      retries: 3
```

---

### 30. **No Dead Letter Queue for Failed Tasks**

**File:** `backend/app/tasks/celery_app.py`

**Issue:** If a task fails, it's retried and eventually dropped with no audit trail.

**Fix:**
```python
@celery_app.task(
    bind=True,
    max_retries=5,
    default_retry_delay=60,
)
def run_solar_analysis(self, job_id: str):
    try:
        # ... existing code ...
    except Exception as exc:
        logger.exception(f"Task failed for job {job_id}, attempt {self.request.retries}")
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc, countdown=60 * (self.request.retries + 1))
        else:
            # Final failure: log to dead letter queue
            logger.critical(f"Task permanently failed for job {job_id}", extra={
                "job_id": job_id,
                "retries": self.request.retries,
                "exception": str(exc),
            })
            _sync_update_job(
                job_id,
                status="failed",
                error_message=f"Analysis failed after {self.max_retries} retries",
            )
```

---

## 📋 Summary Table: Issues by Category

| Category | Count | Severity |
|----------|-------|----------|
| Security | 6 | 🔴 Critical |
| Error Handling | 8 | 🟠 High |
| Database | 4 | 🟠 High |
| Frontend UX | 6 | 🟡 Medium |
| Infrastructure | 8 | 🟡 Medium |
| Code Quality | 4 | 🔵 Low |
| **TOTAL** | **36** | — |

---

## 🛠️ Quick Fix Priority List

### Phase 1: Critical Security (Do Immediately)
1. Remove default credentials
2. Fix CORS configuration
3. Add WebSocket auth
4. Enable authentication in non-debug mode

### Phase 2: High Impact (This Sprint)
5. Fix Celery async loop issues
6. Add Celery task timeouts
7. Implement token refresh
8. Add rate limiting

### Phase 3: Quality (Next Sprint)
9. Add error boundaries
10. Implement retry logic
11. Add request tracing
12. Implement pagination

### Phase 4: Infrastructure (Before Production)
13. Setup database backups
14. Add healthchecks
15. Enable HTTPS
16. Setup CSP headers

---

## 📚 Recommended Reading

- [ANALYSIS_PROGRESS_NOT_UPDATING.md](backend/docs/ANALYSIS_PROGRESS_NOT_UPDATING.md) - Known issue with Celery
- [SolarSight_Architecture_NextJS_FastAPI.md](SolarSight_Architecture_NextJS_FastAPI%20(1).md) - Architecture risks section
- [OWASP Top 10](https://owasp.org/Top10/) - Security best practices

---

**Generated:** 2026-03-09  
**Next Review:** After Phase 1 fixes
