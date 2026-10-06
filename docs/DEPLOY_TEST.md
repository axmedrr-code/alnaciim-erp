# TEST deployment (Render + Neon + Vercel)

> **This is a temporary TEST environment.** It exists alongside the Railway
> deployment, which stays untouched as the fallback. Nothing here changes
> Railway, its database, any production domain, or DNS.

```
GitHub (main)
  ├─ frontend/  → Vercel project  (TEST ERP)
  ├─ pos/       → Vercel project  (TEST POS)
  └─ backend/   → Render web service  alnaciim-erp-test-api  (render.yaml)
                      └─ Neon PostgreSQL project  (TEST database)
```

## Rules for this environment

- **Separate credentials.** Everything below is created fresh for TEST. Never
  paste Railway's `DATABASE_URL` or `JWT_SECRET` into Render/Vercel, and never
  reuse the TEST values anywhere else.
- **No secrets in git.** `render.yaml` and the `.env.example` files contain
  names and placeholders only. Real values are entered in each platform's
  dashboard (Render, Vercel, Neon) and nowhere else.
- **Data comes from a backup, not from `schema.sql` + `seed.sql`.** The TEST
  database is populated by restoring a verified `pg_dump` of the existing
  database (see "Database" below). `npm run migrate` / `npm run seed` must
  never be pointed at a database that already has data.

## Environment variables

### Backend — Render service `alnaciim-erp-test-api`

| Variable | Where it comes from | Notes |
|---|---|---|
| `DATABASE_URL` | Neon dashboard → TEST project | **Secret.** Entered in Render only. |
| `JWT_SECRET` | Generate a new random value for TEST | **Secret.** Not shared with Railway. |
| `CORS_ORIGIN` | You, once the Vercel URLs are known | Exact origins, comma-separated (below). |
| `DATABASE_SSL` | `render.yaml` → `true` | Neon requires SSL. |
| `JWT_EXPIRES_IN` | `render.yaml` → `8h` | |
| `NODE_VERSION` | `render.yaml` → `22` | Pinned; nothing else pins Node. |
| `BACKUP_CRON_SCHEDULE` | `render.yaml` → `disabled` | See "Known limitations". |
| `PORT` | Injected by Render | Do not set. |

### Frontends — Vercel (one project each: TEST ERP, TEST POS)

| Variable | Value | Notes |
|---|---|---|
| `VITE_API_URL` | `https://<alnaciim-erp-test-api>.onrender.com/api/v1` | Build-time: changing it requires a redeploy. Must end in `/api/v1`. |

Suggested Vercel project names: `alnaciim-erp-test` (from `frontend/`) and
`alnaciim-pos-test` (from `pos/`). Framework preset Vite, build `npm run build`,
output `dist`; `vercel.json` in each folder handles SPA routing.

## CORS

The backend keeps its exact-match allowlist (`CORS_ORIGIN`); it is never `*`.
Matching is exact: `https://host` with no trailing slash, and Vercel preview
URLs will not match — use each project's stable production URL.

```
CORS_ORIGIN=https://<test-erp>.vercel.app,https://<test-pos>.vercel.app
```

To keep the Railway frontend working against this backend as well, append its
origin to the same comma-separated list. To add a URL later, edit
`CORS_ORIGIN` in the Render dashboard and redeploy/restart the service — no
code change is needed.

Order of operations: deploy the backend first (with `CORS_ORIGIN` temporarily
set to a placeholder origin), deploy the two Vercel projects to get their final
URLs, then set `CORS_ORIGIN` to those URLs.

## Database (Neon) — gated, not part of config preparation

1. Confirm access to the source database and take a full `pg_dump -Fc`
   backup. Verify it with `pg_restore --list`, and record its size and table
   counts.
2. Create a Neon project (PostgreSQL 17). Restore with `pg_restore` using the
   **direct** (non-pooled) connection string.
3. Put the Neon connection string into Render as `DATABASE_URL`.

Each of these steps requires explicit approval before it runs.

## Build and start commands

| Target | Install / build | Start / output |
|---|---|---|
| Backend | `npm ci` (no build step) | `npm start` → `node src/index.js`; health check `GET /health` |
| Frontend | `npm ci && npm run build` | static, output `dist` |
| POS | `npm ci && npm run build` | static, output `dist` |

## Known limitations of the TEST setup

- **Login credentials.** The login pages no longer print or pre-fill any
  email or password; both fields start empty. The database's existing user
  passwords are unchanged; test credentials will be handled separately after
  the restore.
- **In-app backups don't work on Render.** The backup feature shells out to
  `pg_dump`, which Render's Node runtime lacks (and its disk is ephemeral), so
  the scheduler is disabled there. Back up at the Neon/`pg_dump` level.
- **Cold starts.** Render's free tier sleeps after ~15 minutes idle and Neon's
  free tier auto-suspends; expect a slow first request.
- **Bulk-import uploads** (Excel/CSV, up to 20 MB) are handled in memory and
  need no persistent disk.

## Tear-down

Delete the Render service, the two Vercel projects and the Neon project.
Railway is unaffected at every step.
