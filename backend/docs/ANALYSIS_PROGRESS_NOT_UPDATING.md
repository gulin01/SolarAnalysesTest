# Why Analysis Job Progress Is Not Updating

When you call `GET /api/analysis/{job_id}/status` (or the frontend polls it), you may see the job stuck with:

- `"status": "queued"`
- `"progress": 0.0`
- `"progress_message": ""`

This document lists **root possible causes** and how to diagnose/fix them. Use it to guide debugging or to prompt a GPT/agent to fix the issue.

---

## How progress is supposed to work

1. **API** – `POST /api/analysis/run` creates an `AnalysisJob` row with `status=queued`, then enqueues a Celery task: `run_solar_analysis.delay(job.id)`.
2. **Celery worker** – Picks up the task, calls `run_solar_analysis(job_id)`.
3. **Task** – Marks the job `status=running`, then runs the solar engine with a `progress_cb(pct, msg)` callback. Each callback calls `_sync_update_job(job_id, progress=pct, progress_message=msg)` to write to the **same** PostgreSQL database.
4. **Frontend** – Gets updates via:
   - **WebSocket** `ws://.../ws/analysis/{job_id}` (polling the DB every 1.5s and sending status/progress/message), and/or
   - **REST polling** `GET /api/analysis/{job_id}/status` every 3s.

If progress never changes, either the task never runs, or it runs but DB updates never succeed, or the frontend is not asking the correct API.

---

## Root possible causes (checklist)

### 1. Celery worker not running

- **Symptom:** Job stays `queued` forever; progress stays 0; no logs from the worker.
- **Reason:** The task is only executed by a Celery worker process. If no worker is running, the task is never picked up.
- **Check:**
  - Docker: `docker compose ps` — is the `worker` service running?
  - Local: Is `celery -A app.tasks.celery_app worker ...` running?
- **Fix:** Start the worker (e.g. `docker compose up -d worker` or run the Celery worker command in your setup).

---

### 2. Worker not connected to the same broker as the API

- **Symptom:** Job stays `queued`; task may appear in one Redis but the worker is consuming from another (or wrong queue).
- **Reason:** API and worker must use the **same** `CELERY_BROKER_URL` (and ideally same `CELERY_RESULT_BACKEND`). Different Redis host/port/db or different broker breaks the link.
- **Check:**
  - Compare `CELERY_BROKER_URL` for the process that runs FastAPI and the process that runs the Celery worker (env vars or `.env`).
  - In Docker, API uses `redis://redis:6379/0`; worker must use the same (e.g. `redis://redis:6379/0`), not `redis://localhost:6379/0` from inside the container.
- **Fix:** Set the same broker/backend URLs for both API and worker (same host, port, and DB index).

---

### 3. Worker cannot reach PostgreSQL (different DATABASE_URL)

- **Symptom:** Task may start then fail; or `_sync_update_job` fails when writing progress, so DB never updates.
- **Reason:** The worker runs in a **separate process** (often another container). It uses `DATABASE_URL` to update the job row. If the worker’s `DATABASE_URL` points to a different DB (e.g. `localhost` vs `postgres:5432` in Docker), it either writes to the wrong DB or cannot connect.
- **Check:**
  - Worker logs for connection errors or SQLAlchemy/asyncpg errors.
  - Ensure worker env has the same `DATABASE_URL` as the API (e.g. in Docker both use `postgresql+asyncpg://...@postgres:5432/...`).
- **Fix:** Set the same `DATABASE_URL` for the worker as for the API (same host, DB name, user).

---

### 4. Task fails before or without updating progress

- **Symptom:** Job may stay `queued` (if the task never runs) or jump to `failed` with an `error_message`; progress may never move.
- **Reason:** Exceptions in the task (e.g. in `_fetch_job_data`, `download_bytes`, `run_analysis`, or inside `progress_cb` / `_sync_update_job`) can prevent any or later progress updates. If the task fails before the first `_sync_update_job(status="running", ...)`, the DB still shows `queued`.
- **Check:**
  - Celery worker logs for tracebacks.
  - `GET /api/analysis/{job_id}/status` — if it eventually returns `status: "failed"` and `error_message`, the task ran but threw.
- **Fix:** Fix the underlying error (missing model file, bad EPW path, import errors in solar engine, etc.). Ensure the task marks `status="running"` at the very start and that progress callbacks are invoked and don’t raise.

---

### 5. asyncio.run() / event loop issues in the worker

- **Symptom:** Task runs but progress (and sometimes `status="running"`) never appears in the DB; worker may log event-loop or “already closed” errors.
- **Reason:** The worker is synchronous. Progress updates use `_sync_update_job` → `asyncio.run(_async_update_job(...))`. Nested or repeated `asyncio.run()` in the same process, or running inside an existing event loop, can cause failures or silent skips.
- **Check:** Worker logs for `Event loop is closed`, `Cannot run the event loop while another loop is running`, or similar.
- **Fix:**
  - Use a single event loop per process or a sync DB driver in the worker (e.g. sync SQLAlchemy + `psycopg2` only in the worker) so progress updates don’t rely on `asyncio.run()` in a Celery task.
  - Or run the async update in a thread with a dedicated loop, and ensure no shared loop is closed too early.

---

### 6. _sync_update_job / _async_update_job failing silently

- **Symptom:** Task runs and may complete (or fail later), but `progress` and `progress_message` (and sometimes `status`) never change in the DB.
- **Reason:** Exceptions inside `_async_update_job` (e.g. DB connection, wrong column name, transaction rollback) are not logged or re-raised, so the task continues while the DB is never updated.
- **Check:**
  - Add logging or try/except in `_sync_update_job` and `_async_update_job`; run the task and watch for errors.
  - Verify the worker’s DB connection (same DB, same schema, table `analysis_jobs` has column `analysis_mode`).
- **Fix:** Ensure `analysis_jobs` has an `analysis_mode` column (see schema migration / startup check). Add error handling and logging in `_sync_update_job` so DB update failures are visible and, if desired, re-raised so the task is marked failed.

---

### 7. Wrong or missing AsyncSession in the worker

- **Symptom:** Progress updates never persist; worker might log SQLAlchemy or driver errors.
- **Reason:** In `_async_update_job`, the code uses `async_sessionmaker(engine, expire_on_commit=False)` without explicitly passing `class_=AsyncSession`. With an async engine this is usually fine, but mismatched session/engine types can cause odd behavior.
- **Check:** Worker logs when progress_cb runs; try a single update manually with the same code path.
- **Fix:** Use `async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)` and ensure the worker uses the same SQLAlchemy and async driver versions as the API.

---

### 8. Frontend not polling the same API / wrong job id

- **Symptom:** Backend and DB show updated progress, but the UI never changes.
- **Reason:** Frontend polls a different base URL (e.g. different host/port) or a different `job_id`, so it never sees the updated job.
- **Check:** Compare `NEXT_PUBLIC_FASTAPI_URL` (or equivalent) with the URL the browser uses for `GET /api/analysis/{job_id}/status` and WebSocket. Confirm the same `job_id` is used after `POST /api/analysis/run`.
- **Fix:** Use one consistent API base URL and the `job_id` returned from the run endpoint.

---

### 9. WebSocket not connected or wrong URL

- **Symptom:** REST polling might show updates, but the “live” progress (e.g. over WebSocket) never updates.
- **Reason:** WebSocket URL is wrong (e.g. `ws` vs `wss`, wrong path, or wrong host), or the connection drops and the UI doesn’t fall back to polling.
- **Check:** Browser dev tools → Network → WS; confirm connection to `ws://.../ws/analysis/{job_id}` and that messages are received.
- **Fix:** Correct the WebSocket URL and ensure the frontend still polls REST when WebSocket is unavailable so progress still updates.

---

### 10. Caching or proxy returning stale job status

- **Symptom:** DB has updated progress but API responses still return old values.
- **Reason:** HTTP cache or reverse proxy caching `GET /api/analysis/{job_id}/status`.
- **Check:** Call the status endpoint from the same host as the app and from the browser; compare with a direct DB query.
- **Fix:** Disable caching for the analysis status endpoint (e.g. `Cache-Control: no-store`) or fix proxy cache rules.

---

## Quick diagnostic steps (for a GPT or developer)

1. **Confirm the worker is running**  
   - Docker: `docker compose ps` and logs: `docker compose logs worker`  
   - Look for “ready” or “celery@... ready”.

2. **Confirm the task is enqueued and consumed**  
   - After `POST /api/analysis/run`, check worker logs for a log line containing the `job_id` or task name.  
   - If nothing appears, broker/queue/worker connection is wrong (causes 1 or 2).

3. **Confirm the job row is updated**  
   - Connect to the **same** PostgreSQL the API uses and run:  
     `SELECT id, status, progress, progress_message FROM analysis_jobs WHERE id = '<job_id>';`  
   - Trigger a new run and poll this row. If it never changes from `queued` / 0, the task either didn’t run or didn’t succeed in updating the DB (causes 3–7).

4. **Check worker logs for errors**  
   - Look for tracebacks, “Event loop”, “connection refused”, “column … does not exist”, or async/SQLAlchemy errors. Map them to the causes above.

5. **Verify API and worker config**  
   - Same `DATABASE_URL`, `CELERY_BROKER_URL`, and `CELERY_RESULT_BACKEND` for both.  
   - Same Redis and Postgres from the worker’s perspective (e.g. use service names in Docker).

---

## Code locations (for fixing)

- **Enqueue task:** `backend/app/api/analysis.py` — `run_analysis()` → `run_solar_analysis.delay(job.id)`.
- **Task implementation:** `backend/app/tasks/analysis_task.py` — `run_solar_analysis`, `_sync_update_job`, `_async_update_job`, `progress_cb`.
- **Progress writes:** Same file — `progress_cb` calls `_sync_update_job(job_id, progress=pct, progress_message=msg)`.
- **Solar engine callbacks:** `backend/app/services/solar_engine.py` — `run_analysis(..., progress_cb=progress_cb)` and internal `progress_cb(...)` calls.
- **Status API:** `backend/app/api/analysis.py` — `GET /{job_id}/status` returns the `AnalysisJob` row (status, progress, progress_message).
- **WebSocket:** `backend/app/api/websocket.py` — `analysis_progress` reads the same `AnalysisJob` and sends status/progress/message.
- **Frontend polling:** `frontend/hooks/useAnalysisPolling.ts` — `queries.analysisStatus(jobId)` and store updates.
- **Frontend WebSocket:** `frontend/components/analysis/ProgressTracker.tsx` — `useWebSocket(..., onMessage: ...)`.

---

## Expected result after fixes

- After `POST /api/analysis/run`, the job moves to `status: "running"` and `progress` / `progress_message` update over time (via worker callbacks).
- `GET /api/analysis/{job_id}/status` returns increasing progress and current message.
- Frontend progress bar and message update (via WebSocket or polling).
- When the task finishes, status becomes `"completed"` or `"failed"` and progress reaches 100 or stops at the last value.

Use this README to systematically rule out each cause and to prompt a GPT or developer to implement the corresponding fixes in the codebase.
