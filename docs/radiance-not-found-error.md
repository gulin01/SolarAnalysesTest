# Error: "No Radiance installation was found"

## What happened

The Celery worker logs show:

```
AssertionError: No Radiance installation was found.
```

This crashes the analysis job instead of falling back to the synthetic engine.

---

## Root Causes

### 1. Wrong exception type in the fallback handler (critical)

In `backend/app/services/solar_engine.py`, the `_run_annual` fallback only caught Python import errors:

```python
# BEFORE (broken)
except (ImportError, ModuleNotFoundError) as e:
    return _synthetic_result(...)
```

`ladybug_radiance` raises an **`AssertionError`** — not an `ImportError` — when it cannot find the `gendaymtx` Radiance binary:

```python
# ladybug_radiance/skymatrix.py line ~550
assert GENDAYMTX_EXE is not None, 'No Radiance installation was found.'
```

Because `AssertionError` was not in the except clause, the exception propagated all the way up and failed the job.

**Fix applied** — `solar_engine.py` now catches `AssertionError` too:

```python
# AFTER (fixed)
except (ImportError, ModuleNotFoundError, AssertionError) as e:
    logger.warning("Annual radiation study unavailable (%s); using synthetic fallback", e)
    return _synthetic_result(mesh, placement, config, str(e), n=face_count)
```

---

### 2. Radiance PATH not exported at Docker runtime (secondary)

`worker/install_radiance.sh` writes the Radiance binary path to `/etc/environment`:

```bash
echo "export PATH=\"/usr/local/radiance/bin:$PATH\"" >> /etc/environment
```

Docker containers do **not** source `/etc/environment` automatically when running `CMD`. So even if Radiance installed successfully during the image build, the `gendaymtx` binary was invisible to the Python process at runtime.

**Fix applied** — `worker/Dockerfile` now uses `ENV` directives (which Docker does apply at runtime):

```dockerfile
ENV PATH="/usr/local/radiance/bin:${PATH}"
ENV RAYPATH="/usr/local/radiance/lib"
```

---

## Behaviour After Fix

| Radiance installed? | Result |
|---|---|
| Yes (and PATH correct) | Full `RadiationStudy` annual simulation |
| No / install failed | Synthetic fallback — realistic random irradiance values, real heatmap geometry |

The synthetic fallback is designed for development and demo purposes. It uses the real building mesh geometry so the heatmap overlay looks correct even without Radiance.

---

## How to Rebuild

After applying the fixes, rebuild the worker image:

```bash
docker compose build worker
docker compose up -d worker
```

Check that Radiance is found:

```bash
docker compose exec worker gendaymtx -version
```

If that returns a version string, full simulation will run. If it returns "not found", the synthetic fallback will be used (which is fine for development).

---

## Related Files

- `backend/app/services/solar_engine.py` — `_run_annual()` fallback handler (line ~113)
- `worker/Dockerfile` — `ENV PATH` / `ENV RAYPATH` directives
- `worker/install_radiance.sh` — Radiance binary download and install script
