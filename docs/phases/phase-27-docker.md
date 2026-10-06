# Phase 27 — API Dockerfile and the full Compose stack

## 1. Goal

Package the API as a small production image, and make "run everything on your machine" (the spec's
local setup) one command: Postgres, Redis, a one-shot migration, and the API.

e-commerce has no application Dockerfile (its README lists it as missing). The image built here is also
a reproducible artefact for any host; Phase 30 deploys natively on Render like e-commerce, but the
image is the fallback for hosts that only take containers.

## 2. What I will understand after this phase

1. Multi-stage builds: why the image that **builds** the code isn't the image that **runs** it.
2. How `pnpm deploy` produces a self-contained folder from one workspace package.
3. Why migrations run as a separate one-shot step, not when the API starts.
4. Why the container runs as a non-root user.

## 3. Prerequisites

- Phase 26 done; all tests pass.

## 4. Files

```
counseldesk/
├── Dockerfile                NEW
├── .dockerignore             NEW
└── docker-compose.yml        (migrate + api services, behind a profile)
```

## 5. Concepts

**Multi-stage builds.** The build stage needs everything: the whole monorepo, dev dependencies,
TypeScript, Turbo. The runtime stage needs only the compiled JavaScript and production dependencies.
Building in one stage and copying the result into a clean second stage means the shipped image has no
compiler, no source of other packages, no dev tools — smaller, faster to pull, less to attack.

**`pnpm deploy`.** In a workspace, `apps/api`'s dependencies are symlinks into a shared store, and
`@repo/types` is a link to `packages/types`. You can't copy `apps/api` alone and expect it to run.
`pnpm --filter api --prod deploy /out` writes a standalone folder: `apps/api`'s files plus a real
`node_modules` with production dependencies and the workspace packages copied in. (Checked while this
plan was written: with pnpm 9 the deployed folder includes `dist/` of the API and of `@repo/types`,
even though `dist/` is git-ignored.)

**Migrations as a one-shot job.** If the API ran migrations on start, two instances starting together
would race to migrate, and a failed migration would crash-loop the API. Instead, `migrate` is its own
Compose service that runs `prisma db migrate` and exits; the API starts only after it **completed
successfully**. The migrate service uses the _build_ stage (it needs the Prisma CLI, a dev dependency).

**Non-root.** The official Node image has a `node` user. Running as it means a compromised process
can't write to system paths in the container.

**`--frozen-lockfile`.** The build installs exactly what `pnpm-lock.yaml` says, or fails. An image
built today and one built next month from the same commit contain the same dependency versions.

## 6. Steps

### Step 1 — `.dockerignore`

```
**/node_modules
**/dist
**/.next
**/.turbo
**/.env
**/.env.*
!**/.env.example
.git
```

Without it, `COPY . .` would send your local `node_modules` (built for your machine) and your real
`.env` secrets into the build context.

### Step 2 — `Dockerfile` (repo root)

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# Build stage: whole workspace, dev dependencies, compile, then carve out the API.
FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=api --ui=stream
RUN pnpm --filter api --prod deploy /out

# Runtime stage: only the deployed folder.
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
```

- `corepack enable` installs the pnpm version named in `packageManager`.
- `--mount=type=cache` keeps pnpm's download cache between builds on your machine (not in the image).
- `--filter=api` builds the API and, through `^build`, `@repo/types` and `@repo/content` first.
- `--ui=stream`: there's no terminal in a build, so Turbo's full-screen UI would hang (Phase 00).
- `bcrypt` is a native module; it's installed in the build stage on the same base image (`node:22-slim`,
  Debian) the runtime uses, so its binary matches.

### Step 3 — Compose services for the app

Add to `docker-compose.yml`, below the existing `postgres` and `redis` services:

```yaml
# One-shot: applies pending migrations, then exits. Uses the build stage (needs the Prisma CLI).
migrate:
  profiles: ["app"]
  build:
    context: .
    target: build
  working_dir: /repo/apps/api
  command: ["pnpm", "db:migrate"]
  # The same env as the API: `run --rm migrate pnpm ingest` also uses this service, and ingestion
  # needs the Gemini key and everything env.ts validates.
  env_file: apps/api/.env
  environment:
    DATABASE_URL: postgresql://counseldesk:counseldesk@postgres:5432/counseldesk
    REDIS_HOST: redis
    REDIS_PORT: "6379"
  depends_on:
    postgres:
      condition: service_healthy

api:
  profiles: ["app"]
  build:
    context: .
    target: runtime
  env_file: apps/api/.env
  environment:
    # Inside the Compose network, services are reached by name on their internal ports.
    DATABASE_URL: postgresql://counseldesk:counseldesk@postgres:5432/counseldesk
    REDIS_HOST: redis
    REDIS_PORT: "6379"
    PORT: "4000"
    # development, not production: the local stack is plain http, and production cookies are
    # Secure (browsers won't store them over http). The image itself is the production build.
    NODE_ENV: development
  ports:
    - "4000:4000"
  depends_on:
    migrate:
      condition: service_completed_successfully
    redis:
      condition: service_healthy
  healthcheck:
    # node:22-slim has no curl; Node's fetch does the same job.
    test:
      [
        "CMD",
        "node",
        "-e",
        "fetch('http://localhost:4000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))",
      ]
    interval: 10s
    timeout: 5s
    retries: 5
```

- `profiles: ["app"]`: `docker compose up -d` still starts only the databases (your normal dev setup);
  `docker compose --profile app up -d` starts the whole stack.
- `env_file` brings your secrets (Gemini, Groq, JWT…); `environment` overrides the host names, because
  inside Compose the database is `postgres:5432`, not `localhost:5433`.
- `NODE_ENV: development` in Compose: with `production`, cookies are `Secure` and a browser on
  `http://localhost` would drop them — every chat message would look like a new visitor and staff login
  would fail. The code in the image is the same production build; only the environment differs. (The
  Dockerfile's own `ENV NODE_ENV=production` is the default for real deployments.)
- Ingestion is a manual, occasional job, not a service:
  `docker compose --profile app run --rm migrate pnpm ingest` (the build image has `tsx` and the pages).

Phase 31 adds the website as a third app service.

## 7. Commit points

1. `build: add multi-stage api dockerfile and dockerignore`
2. `build: add migrate and api services to compose behind an app profile`

## 8. Verify

```bash
docker compose --profile app build
docker compose --profile app up -d
docker compose ps
# counseldesk-postgres healthy, counseldesk-redis healthy, migrate exited (0), api healthy

docker compose logs migrate | tail -5          # migrations applied (or "up to date")
curl -s localhost:4000/health                  # {"status":"success","data":{"status":"ok",…}}

docker compose --profile app run --rm migrate pnpm ingest   # once, against the compose database
curl -sN -c /tmp/v -b /tmp/v -X POST localhost:4000/chat -H 'content-type: application/json' -d '{"message":"What are your hours?"}' | tail -3

docker image ls | grep counseldesk             # runtime image ≈ 250–300 MB (mostly the Node base)
docker compose exec api whoami                 # node
docker compose exec api ls                     # dist  node_modules  package.json … (no other packages' source)

docker compose --profile app down              # stop (keep volumes)
```

## 9. Common mistakes

- **No `.dockerignore`.** Your `.env` lands in an image layer and stays in its history.
- **Running migrations in the API's start command.** Two replicas race; a bad migration crash-loops the
  service.
- **`localhost` inside a container** for the database. It means the container itself; use the service
  name.
- **Installing in the runtime stage.** Different stage, different native binaries, slower builds.
- **Building with `--ui=tui`** (Turbo's default in `turbo.json`) inside Docker: the build hangs.

## 10. Interview prep

**Q: How do you containerise a service in a pnpm monorepo?**
A: Multi-stage: install the whole workspace with a frozen lockfile and build in the first stage, then
`pnpm deploy --prod` the one package into a standalone folder and copy only that into a slim runtime
image that runs as a non-root user.

**Q: When do migrations run?**
A: As a one-shot job before the app starts — a separate Compose service the API depends on with
`service_completed_successfully`. Never inside app startup, where replicas would race.

## 11. Resume-safe claim

"Containerised the API with a multi-stage, non-root Docker image built from a pnpm monorepo, and a
Compose stack with one-shot migrations and health-gated startup."

## 12. Definition of done

- [ ] `docker compose --profile app up -d` brings everything up, `migrate` exits 0, `api` is healthy
- [ ] Chat works against the containerised API after a one-off ingest
- [ ] The container runs as `node` and contains no other workspace sources
- [ ] Plain `docker compose up -d` still starts only Postgres and Redis
