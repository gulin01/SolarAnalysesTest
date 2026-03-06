# Fix: "column analysis_jobs.analysis_mode does not exist"

## What’s going wrong

The app expects the column **`analysis_mode`** (SQLAlchemy model uses `mapped_column("analysis_mode", ...)`), but the database table **`analysis_jobs`** still has the old column **`mode`**. So you get:

`UndefinedColumnError: column analysis_jobs.analysis_mode does not exist`

---

## Why this can happen (list of reasons)

1. **Migration not applied to this database**  
   `alembic upgrade head` was run against a different database (e.g. different `DATABASE_URL`, or run on your host while the app uses the Postgres in Docker). The DB the app uses was never migrated.

2. **`create_all()` does not alter existing tables**  
   On startup the app runs `Base.metadata.create_all()`. That only creates missing tables; it does **not** rename or add columns. So if `analysis_jobs` already existed with column `mode`, it stays that way until a migration runs.

3. **Migration “ran” but the rename was skipped**  
   The migration only renames if it finds column `mode` in `information_schema.columns`. If the schema check used the wrong schema (e.g. not `public`) or the check failed for another reason, the rename was skipped but Alembic may still have marked revision `001` as applied.

4. **Revision marked applied but upgrade failed**  
   Alembic’s `alembic_version` table can have revision `001` even if `upgrade()` failed or didn’t do the rename (e.g. due to the conditional). Alembic won’t run that revision again.

5. **New DB or recreated volume after migration**  
   Postgres was recreated (new volume) after you had run the migration. Then the app started (possibly with an older image/code) and `create_all()` created `analysis_jobs` again with the old schema (column `mode`). So you end up with `mode` and no `analysis_mode`.

6. **Backend container not using the same code/volume as when migration ran**  
   If the migration was run in a container that has the migration file (e.g. via volume mount) but the app sometimes runs in a container built from an image that doesn’t include the migration or uses a different DB URL, the DB the app uses might never have been migrated.

---

## Fix (re-run the rename)

The migration was updated to:

- Use **explicit `public` schema** in the column check.
- Use **raw SQL** `ALTER TABLE ... RENAME COLUMN` for the rename.
- Be **idempotent**: only rename when `mode` exists and `analysis_mode` does not.

Re-run the migration so the rename is applied to the DB the app actually uses:

```bash
# From project root, with backend DB (e.g. Docker) running:
docker compose exec backend alembic downgrade base
docker compose exec backend alembic upgrade head
```

- **downgrade base**: Unmarks revision `001`; the downgrade step does nothing if `analysis_mode` doesn’t exist (your current state).
- **upgrade head**: Runs revision `001` again and renames `mode` → `analysis_mode` if the table still has `mode`.

Then restart the backend and try again. The error should be resolved.
