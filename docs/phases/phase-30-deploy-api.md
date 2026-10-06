# Phase 30 — Deploy the API

## 1. Goal

A live API: Postgres with pgvector on **Neon**, Redis on a hosted free tier, the API on **Render**'s
free tier (the same host as e-commerce), migrations applied on each deploy, content ingested and a staff
account seeded, and two scheduled jobs (retention, lead re-notify) run by GitHub Actions for free.

## 2. What I will understand after this phase

1. What changes between local and production: TLS, proxies, cookies, region latency, cold starts.
2. Why the database and the API should be in the same region.
3. How deploy filters stop unrelated commits from redeploying (a problem you hit in e-commerce).
4. How to run scheduled maintenance without a paid cron service.

## 3. Prerequisites

- Phase 29 done; `main` green.
- Accounts: Neon, Render, a hosted Redis (see Step 2), Resend (optional, for lead emails).

## 4. Files

```
.github/workflows/maintenance.yml    NEW  scheduled retention + lead re-notify
docs/deploy.md                       NEW  what is deployed where, and how to redeploy
apps/api/.env.example                (production notes)
```

## 5. Concepts

**Region.** Every chat message makes several database round trips (load conversation, history, save
messages, search). At ~1 ms each in one region that's nothing; across an ocean at ~150 ms each, it adds
seconds. Pick the Render region first, then create the Neon project in the closest region.

**Direct vs pooled connections on Neon.** Neon offers a pooled endpoint (PgBouncer in transaction mode)
and a direct one. Pooling in transaction mode breaks session features some tools rely on (prepared
statements, advisory locks used during migrations). With one small API instance, the direct endpoint is
simplest and safe for both migrations and the app. Check Neon's current docs on this before choosing.

**Redis for BullMQ in production.** BullMQ needs `noeviction` (Phase 00) and polls Redis continuously,
which burns through command-count quotas on some serverless Redis free tiers. A hosted Redis with a
fixed memory limit and a configurable eviction policy (Redis Cloud's free database is the one e-commerce
uses — the `REDIS_USERNAME`/`REDIS_PASSWORD` variables exist for it) fits better. Set its eviction policy
to `noeviction` in the provider's settings, and check the current free-tier limits.

**Behind Render's proxy.** Requests reach the app through Render's proxy, so the client IP is in
`X-Forwarded-For`, trusted only from configured proxies (Phase 08). e-commerce's README records
`TRUSTED_PROXY_CIDRS=127.0.0.1/32` for Render. Verify on your deploy: rate-limit keys in Redis should
show varying client IPs, not one proxy IP for everyone.

**Cookies across sites.** The API (`*.onrender.com`) and the site (`*.vercel.app`) are different sites,
so with `NODE_ENV=production` the cookies are `Secure; SameSite=None` (Phase 06) — already handled.

**Deploy filters.** Without them, every push redeploys — and on the free tier every redeploy is a cold
start for the next visitor. Render's _Build Filters_ list the paths whose changes trigger a deploy. You
set exactly this up for e-commerce; the list here covers the API and the shared packages it depends on.

**Cold starts.** Render's free web services sleep when idle and take a while to wake. The widget (Phase 34) shows a "waking up" notice, reusing what you built for ShopyMart. Keeping it awake with pings
defeats the purpose of a free tier and may be against its terms; the honest fix is the notice.

**Free scheduling.** Render's cron jobs aren't free; GitHub Actions' `schedule` trigger is. A workflow
that runs `pnpm --filter api retention` daily and `leads:renotify` hourly, with the production database
URL as a secret, does the job.

## 6. Steps

### Step 1 — Neon

1. Create a project in the region closest to your Render region, Postgres 17.
2. Copy the **direct** connection string; make sure it ends in `?sslmode=require`.
3. From your laptop, apply migrations and check pgvector:

```bash
cd apps/api
DATABASE_URL='postgresql://…neon.tech/neondb?sslmode=require' pnpm db:migrate
DATABASE_URL='postgresql://…?sslmode=require' pnpm db:verify
psql 'postgresql://…?sslmode=require' -c '\dx'          # vector listed
```

If `CREATE EXTENSION vector` fails, enable pgvector in Neon's dashboard per its docs and rerun.

### Step 2 — Redis

Create a free database on a hosted Redis provider, set its eviction policy to **noeviction**, and note
host, port, username and password.

### Step 3 — Render web service

New → Web Service → connect the repo.

| Setting           | Value                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime           | Node                                                                                                                                 |
| Root directory    | (empty — the repo root)                                                                                                              |
| Build command     | `corepack enable && pnpm install --frozen-lockfile && pnpm turbo run build --filter=api --ui=stream && pnpm --filter api db:migrate` |
| Start command     | `pnpm --filter api start`                                                                                                            |
| Health check path | `/health`                                                                                                                            |
| Instance type     | Free                                                                                                                                 |

Migrations in the build command: on the free tier there's no separate pre-deploy step, and a failed
migration then fails the build — the old version keeps serving. The build command has dev dependencies,
so the Prisma CLI is available.

**Environment** (Render dashboard): every variable from `.env.example` for Phases 01–15, with production
values:

```
NODE_ENV=production
NODE_VERSION=22
CORS_ORIGIN=https://<your-site>.vercel.app
SITE_URL=https://<your-site>.vercel.app
STAFF_APP_URL=https://<your-site>.vercel.app
DATABASE_URL=<neon direct url>
REDIS_HOST / REDIS_PORT / REDIS_USERNAME / REDIS_PASSWORD=<hosted redis>
TRUSTED_PROXY_CIDRS=127.0.0.1/32
JWT_SECRET / JWT_REFRESH_SECRET=<two new values from openssl rand -hex 32>
GEMINI_API_KEY / GROQ_API_KEY / model ids
RESEND_API_KEY / EMAIL_FROM / STAFF_NOTIFY_EMAIL
LOG_LEVEL=info
```

- `NODE_VERSION=22`: in e-commerce, Render picked Node 26 from a loose `engines` range. Pin it.
- New JWT secrets for production; never reuse development or CI values.
- The site URL isn't known until Phase 31–32 deploys it; set a placeholder now and update it then.

**Build Filters** (Settings → Build & Deploy → Build Filters → Included Paths):

```
apps/api/**
packages/types/**
packages/content/**
pnpm-lock.yaml
package.json
pnpm-workspace.yaml
turbo.json
```

`packages/content/**` is included because the pages are the knowledge base: a content edit changes the
answers. (It doesn't re-ingest by itself — see Step 4.)

### Step 4 — Content and staff account

From your laptop, against production:

```bash
cd apps/api
DATABASE_URL='<neon>' GEMINI_API_KEY='…' GEMINI_EMBEDDING_MODEL='…' pnpm ingest
DATABASE_URL='<neon>' pnpm seed:staff --email you@yourdomain --name "Your Name"
```

(`env.ts` validates everything at import, so run these with your full local `.env` and only
`DATABASE_URL` overridden: `DATABASE_URL='<neon>' pnpm ingest`.)

Re-run `ingest` whenever you change the pages; it only re-embeds what changed.

### Step 5 — Scheduled maintenance, `.github/workflows/maintenance.yml`

```yaml
name: maintenance

on:
  schedule:
    - cron: "17 * * * *" # hourly: re-queue leads whose email never went out
    - cron: "41 3 * * *" # daily 03:41 UTC: delete old conversations without a lead
  workflow_dispatch:

jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    env:
      NODE_ENV: production
      PORT: "4000"
      CORS_ORIGIN: ${{ vars.CORS_ORIGIN }}
      SITE_URL: ${{ vars.SITE_URL }}
      DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}
      REDIS_HOST: ${{ secrets.PROD_REDIS_HOST }}
      REDIS_PORT: ${{ secrets.PROD_REDIS_PORT }}
      REDIS_USERNAME: ${{ secrets.PROD_REDIS_USERNAME }}
      REDIS_PASSWORD: ${{ secrets.PROD_REDIS_PASSWORD }}
      JWT_SECRET: ${{ secrets.PROD_JWT_SECRET }}
      JWT_REFRESH_SECRET: ${{ secrets.PROD_JWT_REFRESH_SECRET }}
      STAFF_NOTIFY_EMAIL: ${{ vars.STAFF_NOTIFY_EMAIL }}
      GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
      GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
      GEMINI_CHAT_MODEL: ${{ vars.GEMINI_CHAT_MODEL }}
      GEMINI_EMBEDDING_MODEL: ${{ vars.GEMINI_EMBEDDING_MODEL }}
      GROQ_CHAT_MODEL: ${{ vars.GROQ_CHAT_MODEL }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run build --filter=api --ui=stream
      - name: Re-notify leads
        if: github.event.schedule == '17 * * * *' || github.event_name == 'workflow_dispatch'
        run: pnpm --filter api leads:renotify
      - name: Retention
        if: github.event.schedule == '41 3 * * *' || github.event_name == 'workflow_dispatch'
        run: pnpm --filter api retention --days 90
```

The whole env block exists because `env.ts` validates every variable at import, even for a script that
uses three of them — the price of fail-fast configuration. Odd minutes (`17`, `41`) avoid the top of the
hour, when GitHub's scheduler is busiest and runs are delayed.

### Step 6 — Smoke test the deploy

```bash
API=https://<your-api>.onrender.com
curl -s $API/health                       # postgres up, redis up (first call may take a while: cold start)
curl -sN -c /tmp/p -b /tmp/p -X POST $API/chat -H 'content-type: application/json' \
  -H 'Origin: https://<your-site>.vercel.app' -d '{"message":"What are your office hours?"}' | tail -3
curl -s -i -X OPTIONS $API/chat -H 'Origin: https://<your-site>.vercel.app' -H 'Access-Control-Request-Method: POST' | grep -i access-control-allow
```

Check the Render logs: one JSON line per request with a `requestId`. Then check that rate-limit keys in
the hosted Redis show your real IP (`rl:global:ip:<your ip>`), not a proxy address.

### Step 7 — `docs/deploy.md`

What runs where (Render web service, Neon project + region, Redis provider, Vercel later), which
environment variables each needs (names only), how to redeploy, how to re-ingest, how to rotate a
secret, and the free-tier limits you observed (cold-start time, quotas). Half a page.

## 7. Commit points

1. `ci: add scheduled maintenance workflow for retention and lead re-notify`
2. `docs: document the deployment`

## 8. Verify

- `/health` on the Render URL returns `postgres: up, redis: up`.
- A chat request returns a grounded, cited answer.
- Staff login works from `curl` with a cookie jar against the deployed API (the site comes later).
- A docs-only commit does **not** trigger a Render deploy (build filters); a change under `apps/api`
  does.
- The maintenance workflow runs successfully from `workflow_dispatch`.

## 9. Common mistakes

- **API and database in different regions.** Everything works and every answer is a second slower.
- **Reusing development JWT secrets in production.**
- **Leaving Render to pick the Node version** from `engines`.
- **Neon's pooled URL for migrations.** Migration tooling can fail in odd ways through a
  transaction-mode pooler.
- **Forgetting the build filters** and spending every push on a redeploy and a cold start.
- **An evicting Redis for BullMQ.** Queued lead emails vanish under memory pressure.

## 10. Interview prep

**Q: Walk me through your deployment.**
A: Render free web service (build runs migrations, so a failed migration fails the build and the old
version keeps serving), Neon Postgres with pgvector in the same region, a hosted Redis with
`noeviction` for the queue and limiter, build filters so only relevant paths redeploy, pinned Node, and
GitHub Actions on a schedule for retention and lead re-notification.

**Q: What's different in production?**
A: TLS and cross-site cookies (`Secure; SameSite=None`), trusted-proxy IP extraction, region latency,
and cold starts on the free tier, which the widget explains to visitors.

## 11. Resume-safe claim

"Deployed the API on Render with Neon Postgres/pgvector and hosted Redis, transactional migrations at
build time, path-filtered deploys, and scheduled maintenance jobs via GitHub Actions."

## 12. Definition of done

- [ ] Live `/health` is green; a live chat answer is grounded and cited
- [ ] Production content ingested; a production staff account exists
- [ ] Build filters verified with a docs-only commit
- [ ] Maintenance workflow runs green
- [ ] `docs/deploy.md` written
