# Phase 00 — Monorepo setup

## 1. Goal

Create the empty-but-working skeleton of CounselDesk: a pnpm + Turborepo monorepo with the shared
TypeScript and ESLint configs, a shared Zod package that builds, an API app that imports it, and a
Docker Compose file that runs Postgres (with pgvector) and Redis.

Nothing user-facing exists after this phase. What exists is the thing every later phase stands on:
`pnpm install`, `pnpm build`, `pnpm typecheck` and `pnpm lint` all pass from the repo root, and the
two databases start healthy with one command.

This is the same layout as e-commerce, with three deliberate fixes:

- the API and the shared package are **ESM that actually runs** under `node dist/index.js`
  (the e-commerce Postgres port's build cannot — see Concepts),
- the API is **linted** (e-commerce's backends never were),
- one TypeScript version is pinned for the whole repo.

## 2. What I will understand after this phase

1. Why a monorepo with a shared `@repo/types` package means the API and the frontend can never
   disagree about a request shape.
2. What `"dependsOn": ["^build"]` in `turbo.json` does, and why `typecheck` needs it.
3. Why ESM needs `.js` on relative imports, and how `module: NodeNext` makes the compiler enforce it.
4. Why the queue Redis runs with `noeviction` and append-only persistence.
5. How to read a dependency table and say why every package exists.

## 3. Prerequisites

- Node **22.18 or newer** (`node -v`). Prisma 8 refuses older versions (its `engines` field says
  `>=22.18.0`), vitest needs `^22.12`, Next.js needs `>=20.9`. 22 satisfies all of them.
- pnpm 9 (`corepack enable` gives you the version pinned in `packageManager`).
- Docker with Compose v2 (`docker compose version`).
- Git.
- No earlier phases. This is the first one.

> Ports. Your machine already has a container named `postgresql` on host port **5432**, and the
> e-commerce Redis uses **6379**. CounselDesk therefore maps Postgres to **5433** and Redis to
> **6381** on the host, so both projects can run at the same time.

## 4. Files

```
counseldesk/
├── .gitignore                         COPY   e-commerce/.gitignore
├── .nvmrc                             NEW
├── package.json                       ADAPT  e-commerce/package.json
├── pnpm-workspace.yaml                ADAPT  e-commerce/pnpm-workspace.yaml
├── turbo.json                         ADAPT  e-commerce/turbo.json
├── docker-compose.yml                 ADAPT  e-commerce/docker-compose.yml
├── docs/phases/                       (this plan)
├── apps/
│   └── api/
│       ├── package.json               ADAPT  e-commerce/apps/backends/postgres/package.json
│       ├── tsconfig.json              NEW    (extends the shared base, unlike e-commerce's backends)
│       ├── eslint.config.js           NEW
│       ├── .env.example               ADAPT  e-commerce/apps/backends/postgres/.env.example
│       └── src/index.ts               NEW    (temporary; Phase 01 replaces it)
└── packages/
    ├── typescript-config/             COPY   e-commerce/packages/typescript-config/*
    │   ├── base.json
    │   ├── nextjs.json
    │   ├── react-library.json
    │   └── package.json
    ├── eslint-config/                 COPY   e-commerce/packages/eslint-config/*
    │   ├── base.js
    │   ├── next.js
    │   ├── react-internal.js
    │   ├── README.md
    │   └── package.json               (devDependency versions refreshed, see Step 4)
    └── types/                         ADAPT  e-commerce/packages/types/{package.json,tsconfig.json}
        ├── package.json
        ├── tsconfig.json
        ├── eslint.config.js           NEW
        └── src/
            ├── index.ts
            └── common.ts
```

`apps/web` (Next.js) and `apps/widget` (the embeddable script) are **not** created here. They are
created in Phases 31 and 33, when there is something to put in them. An empty Next.js app would
only add an install you can't verify and a build that does nothing. Their packages are still listed
in the dependency table below so the whole project's stack is visible from day one.

## 5. Concepts

**Monorepo with workspaces.** One git repo holds several packages (`apps/api`, `packages/types`…).
pnpm links them to each other through `workspace:*`, so `apps/api` imports `@repo/types` like any npm
package but always gets the local code. Without it you would copy schemas between repos and they
would drift; the first sign would be a 400 from a field the client thinks is optional.

**Turborepo and `^build`.** Turbo runs a script (`build`, `typecheck`…) in every package, in
dependency order, and caches the result. `"dependsOn": ["^build"]` means "before running this task in
a package, run `build` in the packages it depends on". The API reads `@repo/types` from its compiled
`dist/`, so if `typecheck` ran first on a fresh clone it would fail with "Cannot find module". The
caret is the whole fix. The cache means a second run of an unchanged package takes milliseconds
("FULL TURBO").

**ESM and `.js` import suffixes.** In ES modules, Node resolves imports exactly as written: it does
not try adding `.js`. TypeScript does not rewrite import paths when it compiles. So
`import { x } from "./env"` compiles to `./env`, and Node fails with `ERR_MODULE_NOT_FOUND`. This is
real: in the e-commerce Postgres port, `node dist/utils/errors/appAssert.js` fails exactly this way.
With `module` and `moduleResolution` set to `NodeNext` (inherited from the shared `base.json`),
the compiler refuses a relative import without an extension (error TS2835), so you write
`"./env.js"` and the built code runs. You write `.js` even though the source file is `.ts`, because
the path must be correct for the _output_.

**One TypeScript version.** The newest TypeScript is 7.0.2, but `typescript-eslint` (which the
shared ESLint config uses) supports only `>=4.8.4 <6.1.0`. The repo pins **5.9.3**, the newest
release in that range. The pgvector extension for Prisma needs `>=5.9`, so 5.9.3 satisfies both.

**Two kinds of Redis memory policy.** A queue stores jobs; if Redis evicted one to free memory, a
lead notification would silently disappear. `noeviction` makes Redis refuse new writes instead of
deleting data, which is a loud failure you can see. `--appendonly yes` writes every change to disk so
queued jobs survive a container restart. This project has no cache, so it needs only this one
instance (e-commerce needs a second, evicting one for its cache).

**`noUncheckedIndexedAccess`.** The shared `base.json` turns it on, and e-commerce's backends never
had it. It makes `array[0]` typed as `T | undefined`. That is correct (an empty array has no first
element) and it will make you write a check in a few places later, for example when reading the
first search result. Treat those errors as the compiler finding a real bug, not as noise.

## 6. Steps

### Step 1 — Create the repo

```bash
mkdir -p ~/Code/counseldesk && cd ~/Code/counseldesk
git init
echo 22 > .nvmrc
cp ~/Code/e-commerce/.gitignore .gitignore
```

`.gitignore` is copied unchanged. It already ignores `node_modules/`, `dist/`, `.next/`, `.turbo/`,
`coverage/` and every `.env*` file except `.env.example`.

### Step 2 — Root `package.json`, workspace and Turbo config

Copy e-commerce's root `package.json` to `package.json`, change only:

- `name` → `"counseldesk"`
- remove the `"workspaces"` array (that is npm/yarn syntax; pnpm reads `pnpm-workspace.yaml`)
- remove the duplicate `"check-types"` script (it ran the same thing as `typecheck`)
- add `"format:check"`
- devDependency versions → the verified ones below
- `engines.node` → `">=22.18.0"`

Result:

```json
{
  "name": "counseldesk",
  "private": true,
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "format": "prettier --write \"**/*.{ts,tsx,md}\"",
    "format:check": "prettier --check \"**/*.{ts,tsx,md}\""
  },
  "devDependencies": {
    "prettier": "^3.9.9",
    "turbo": "^2.11.7",
    "typescript": "5.9.3"
  },
  "engines": {
    "node": ">=22.18.0"
  },
  "packageManager": "pnpm@9.15.4"
}
```

`typescript` is pinned exactly (no `^`), as in e-commerce, so every package and CI compile with the
same compiler.

`pnpm-workspace.yaml` — copy e-commerce's, remove the `apps/backends/*` line (there is one API, it
lives at `apps/api`):

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`turbo.json` — copy e-commerce's, change only: drop the `check-types` task, give `lint` and `test`
`"dependsOn": ["^build"]` (both read `@repo/types` from `dist/`, same reason as `typecheck`), and
trim `outputs` to the folders this project produces:

```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "ui": "tui",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["$TURBO_DEFAULT$", ".env*"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] },
    "dev": { "cache": false, "persistent": true }
  }
}
```

- `outputs` tells Turbo which folders to cache and restore. `.next/cache` is excluded because Next
  manages it itself.
- `inputs` includes `.env*` so changing an env file invalidates the build cache.
- `dev` is never cached and is `persistent` (it does not exit).

### Step 3 — Shared TypeScript config

```bash
mkdir -p packages
cp -r ~/Code/e-commerce/packages/typescript-config packages/
```

COPY verbatim, no changes. `base.json` is the one the API and `@repo/types` extend. `nextjs.json`
is used in Phase 31.

### Step 4 — Shared ESLint config

```bash
mkdir -p packages/eslint-config
cp ~/Code/e-commerce/packages/eslint-config/{base.js,next.js,react-internal.js,README.md,package.json} packages/eslint-config/
```

Copy `base.js`, `next.js`, `react-internal.js` and `README.md` unchanged. (Do not copy
`node_modules`.) In `package.json`, change only the `devDependencies` block to these verified
versions. They are the newest releases **within the same major versions e-commerce uses**, because
the copied config files are written against those majors:

```json
  "devDependencies": {
    "@eslint/js": "^9.39.5",
    "@next/eslint-plugin-next": "^16.3.8",
    "eslint": "^9.39.5",
    "eslint-config-prettier": "^10.1.8",
    "eslint-plugin-only-warn": "^1.2.1",
    "eslint-plugin-react": "^7.37.5",
    "eslint-plugin-react-hooks": "^5.2.0",
    "eslint-plugin-turbo": "^2.11.7",
    "globals": "^16.5.0",
    "typescript": "5.9.3",
    "typescript-eslint": "^8.71.1"
  }
```

`base.js` exports a named `config` array: recommended JS rules, recommended TypeScript rules,
Prettier's "turn off formatting rules" preset, Turbo's undeclared-env-var check, and `only-warn`,
which downgrades every rule to a warning so lint never blocks a build in this phase of learning.

### Step 5 — The shared schema package, `@repo/types`

```bash
mkdir -p packages/types/src
```

`packages/types/package.json` — ADAPT from e-commerce's. Changes: `"type": "module"` instead of
`"commonjs"`, an `exports` map, a `lint` script, the bogus `test` script removed, versions refreshed,
and `@types/express` dropped (shared schemas must not depend on Express).

```json
{
  "name": "@repo/types",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
  "dependencies": {
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "eslint": "^9.39.5",
    "typescript": "5.9.3"
  }
}
```

Why ESM here when e-commerce's was CommonJS: the API is ESM (Prisma 8's client is ESM-only, as the
e-commerce port shows), and the e-commerce client had to alias `@repo/types` to its source because a
browser bundler can't read named exports from CommonJS (see `e-commerce/apps/client/vite.config.ts`).
One ESM build serves the API, Next.js and the widget without that workaround.

`packages/types/tsconfig.json` — ADAPT from e-commerce's: same `extends`, `rootDir`, `outDir`,
`include`, `exclude`; `strictNullChecks` removed because `base.json` already sets `strict: true`,
which includes it.

```json
{
  "extends": "@repo/typescript-config/base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

`packages/types/eslint.config.js` — NEW:

```js
import { config } from "@repo/eslint-config/base";

export default config;
```

`packages/types/src/common.ts` — NEW. One real schema, so the build has something to compile and the
API has something to import. Phase 19's staff routes (`/staff/leads/:id`) use it.

```ts
import { z } from "zod";

// Route params like /staff/leads/:id. Every table uses uuid primary keys.
export const idParamSchema = z.object({
  id: z.uuid(),
});

export type IdParam = z.infer<typeof idParamSchema>;
```

`z.uuid()` is the Zod 4 top-level form (Zod 3 wrote `z.string().uuid()`).

`packages/types/src/index.ts` — NEW, the barrel every consumer imports from. Note the `.js`:

```ts
export * from "./common.js";
```

### Step 6 — The API app (skeleton only)

```bash
mkdir -p apps/api/src
```

`apps/api/package.json` — ADAPT from `e-commerce/apps/backends/postgres/package.json`. Kept: ESM,
the `dev` / `build` / `start` / `typecheck` scripts. Changed: name, `lint` added, the placeholder
`test` and the `db:*` scripts removed (they come back in Phases 03 and 25 with real commands), and
**only the dependencies this phase uses**. Later phases add theirs; each phase's first step is the
exact `pnpm add` line from the table in this document.

```json
{
  "name": "api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
  "dependencies": {
    "@repo/types": "workspace:*"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "@types/node": "^22.20.5",
    "eslint": "^9.39.5",
    "tsx": "^4.23.15",
    "typescript": "5.9.3"
  }
}
```

`@types/node` is on the 22 line to match the Node version you run. Installing `@types/node@26`
would let you call APIs your runtime doesn't have.

`apps/api/tsconfig.json` — NEW. e-commerce's backends had standalone tsconfigs; this one extends
the shared base so the API gets the same strictness as everything else. Overrides: no DOM types
(this is a server), Node types only, emit JavaScript but not declaration files (nobody imports the
API as a library).

```json
{
  "extends": "@repo/typescript-config/base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"],
    "rootDir": "src",
    "outDir": "dist",
    "declaration": false,
    "declarationMap": false
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

`apps/api/eslint.config.js` — NEW. The shared base plus one rule setting: a name starting with `_`
is deliberately unused. Express error handlers must declare a fourth `_next` parameter they never
read (Phase 01), and without this the linter warns on every one of them.

```js
import { config } from "@repo/eslint-config/base";

export default [
  ...config,
  {
    rules: {
      // A leading underscore marks a deliberately unused name, e.g. Express's 4th error-handler argument.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
```

`apps/api/src/index.ts` — NEW, temporary. It proves the one thing this phase is about: an ESM app
can import the built shared package, both under `tsx` and as compiled JavaScript under plain `node`.
Phase 01 deletes it and writes the real server.

```ts
import { idParamSchema } from "@repo/types";

// Phase 00 only proves the wiring: an ESM app importing the built shared package.
// Phase 01 replaces this file with the real server.
const valid = idParamSchema.safeParse({
  id: "3f2c6c1e-8a51-4f3e-9b7a-2d4f1c0e5a77",
});
const invalid = idParamSchema.safeParse({ id: "not-a-uuid" });

console.log(
  `[api] skeleton ok - valid uuid: ${valid.success}, invalid uuid: ${invalid.success}`,
);
```

### Step 7 — Environment template

`apps/api/.env.example` — ADAPT. It lists **every** variable the API will ever read, grouped by the
phase that starts reading it, so you can see the whole configuration surface now. `constants/env.ts`
(Phase 01) only requires the variables of phases already built; a variable nobody reads yet is
harmless.

Model ids are deliberately blank: they are confirmed against the providers' current docs in Phases
11 and 14, not written from memory. There is no embedding-size variable: the size is fixed by the
`vector(768)` column in the database (Phase 04), so it lives in code next to the schema, not in
configuration that could disagree with it.

```bash
# ---------- Phase 01: server ----------
PORT=4000
NODE_ENV=development
# Comma-separated. 3000 = Next.js (Phase 31), 5173 = widget dev server (Phase 33).
CORS_ORIGIN=http://localhost:3000,http://localhost:5173

# ---------- Phase 02: logging ----------
# debug | info | warn | error
LOG_LEVEL=info

# ---------- Phase 03: database ----------
DATABASE_URL=postgresql://counseldesk:counseldesk@localhost:5433/counseldesk

# ---------- Phase 06: staff auth ----------
# Two different values, 32+ characters each: openssl rand -hex 32
JWT_SECRET=
JWT_REFRESH_SECRET=

# ---------- Phase 08: Redis + rate limiting ----------
REDIS_HOST=localhost
REDIS_PORT=6381
# Empty locally; set both for a hosted Redis.
REDIS_USERNAME=
REDIS_PASSWORD=
# Proxies whose client-IP headers may be trusted (127.0.0.1/32 on Render). Empty locally.
TRUSTED_PROXY_CIDRS=

# ---------- Phase 09: lead notification email ----------
RESEND_API_KEY=
EMAIL_FROM=
STAFF_NOTIFY_EMAIL=
ENABLE_QUEUE_DASHBOARD=false
QUEUE_DASHBOARD_USER=
QUEUE_DASHBOARD_PASSWORD=

# ---------- Phase 11: embeddings ----------
GEMINI_API_KEY=
GEMINI_EMBEDDING_MODEL=

# ---------- Phase 14: chat models ----------
GEMINI_CHAT_MODEL=
GROQ_API_KEY=
GROQ_CHAT_MODEL=

# ---------- Phase 15: citations ----------
# Where the demo firm site runs; citation links point here.
SITE_URL=http://localhost:3000
```

Then:

```bash
cp apps/api/.env.example apps/api/.env
```

`.env` is git-ignored. `.env.example` is committed (the `!.env.example` line in `.gitignore`).

### Step 8 — Docker Compose: Postgres with pgvector, and Redis

`docker-compose.yml` — ADAPT from e-commerce's. Changes:

- the commented-out Postgres service becomes real, using the **pgvector** image so the `vector`
  extension is available
- one Redis instead of two (no cache in this project)
- every image tag pinned (e-commerce used `redis:latest`, which can change under you)
- host ports moved to 5433 / 6381 (see Prerequisites)
- the obsolete top-level `version:` key removed (Compose v2 ignores it and warns)

```yaml
services:
  postgres:
    image: pgvector/pgvector:0.8.7-pg17
    container_name: counseldesk-postgres
    ports:
      - "5433:5432"
    environment:
      POSTGRES_USER: counseldesk
      POSTGRES_PASSWORD: counseldesk
      POSTGRES_DB: counseldesk
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U counseldesk -d counseldesk"]
      interval: 5s
      timeout: 3s
      retries: 5

  # BullMQ jobs and rate-limit windows. `noeviction`: Redis must never drop a queued job to free
  # memory. AOF keeps queued jobs across a restart.
  redis:
    image: redis:7.4
    container_name: counseldesk-redis
    ports:
      - "6381:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes --maxmemory-policy noeviction
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```

- `pgvector/pgvector:0.8.7-pg17` = pgvector 0.8.7 on Postgres 17. Both tags were checked on Docker
  Hub. Phase 30 checks that the hosted Postgres (Neon) offers a matching Postgres and pgvector
  version before deploying.
- Inside the Compose network the services still listen on 5432 and 6379; only the host side moved.
- `healthcheck` lets `docker compose up --wait` return only once both are ready.

### Step 9 — Install, build, commit

```bash
corepack enable          # once per machine; makes `pnpm` the version in packageManager
pnpm install
pnpm format              # Prettier rewrites anything not in its style
```

The first install downloads everything and can take several minutes; later installs reuse pnpm's
store and take seconds.

## 7. Commit points

Commit after each step that leaves a coherent state:

1. `chore: initialise repo with gitignore and node version` (Step 1)
2. `chore: add pnpm workspace and turborepo config` (Step 2)
3. `chore: add shared typescript and eslint configs` (Steps 3–4)
4. `feat(types): add shared zod package with id param schema` (Step 5)
5. `chore(api): add api skeleton importing @repo/types` (Step 6)
6. `chore: add env template and docker compose for postgres and redis` (Steps 7–8)
7. `chore: add lockfile` (Step 9, `pnpm-lock.yaml` — always commit it; CI and Render install with
   `--frozen-lockfile`)

## 8. Verify

Every command below was run on a throwaway copy of this exact setup before this document was
written; the expected output is what it printed.

```bash
# 1. Whole-repo tasks
pnpm build        # Tasks: 2 successful, 2 total   (@repo/types, api)
pnpm typecheck    # Tasks: 3 successful, 3 total
pnpm lint         # Tasks: 3 successful, 3 total   (no warnings)
pnpm format:check # All matched files use Prettier code style!

# 2. Turbo's cache: run build again without changing anything
pnpm build        # Cached: 2 cached, 2 total  ... >>> FULL TURBO

# 3. The ESM fix: the compiled API runs under plain node
node apps/api/dist/index.js
# [api] skeleton ok - valid uuid: true, invalid uuid: false

# 4. And under tsx (what `pnpm --filter api dev` uses)
pnpm --filter api exec tsx src/index.ts
# [api] skeleton ok - valid uuid: true, invalid uuid: false

# 5. Databases
docker compose up -d --wait
docker compose ps                                   # both "(healthy)"

docker exec counseldesk-postgres psql -U counseldesk -d counseldesk -tAc \
  "SELECT name, default_version FROM pg_available_extensions WHERE name = 'vector';"
# vector|0.8.7          (available; Phase 03 enables it)

docker exec counseldesk-postgres psql -U counseldesk -d counseldesk -tAc "SHOW server_version;"
# 17.x

docker exec counseldesk-redis redis-cli CONFIG GET maxmemory-policy
# maxmemory-policy
# noeviction

docker exec counseldesk-redis redis-cli CONFIG GET appendonly
# appendonly
# yes

# 6. Prove the ESM rule is enforced: remove ".js" from packages/types/src/index.ts,
#    run `pnpm build`, read the error, then put it back.
# error TS2835: Relative import paths need explicit file extensions ...
```

## 9. Common mistakes

- **Running a package's `typecheck` directly on a fresh clone.**
  `pnpm --filter api typecheck` skips Turbo, so `@repo/types` has no `dist/` yet and you get
  "Cannot find module '@repo/types'". Run `pnpm typecheck` from the root, or
  `pnpm turbo run typecheck --filter api`, which builds the dependency first.
- **A relative import without `.js`.** The compiler stops you with TS2835. Don't "fix" it by
  switching to `moduleResolution: bundler` (that is how the e-commerce port ended up with a build
  that compiles but cannot run).
- **Installing TypeScript 7** because `pnpm` says "7.0.2 is available". `typescript-eslint` does not
  support it yet (`<6.1.0`), and lint breaks.
- **Port already in use** when starting Compose: something else owns 5433 or 6381. Find it with
  `docker ps --format '{{.Names}} {{.Ports}}'`.
- **`docker compose down -v`** deletes the volumes, meaning every row in Postgres and every queued
  job. Use plain `down` (or `stop`) unless you want a clean slate.
- **Turbo looks frozen** inside a non-interactive shell (an editor task runner, CI, some agents): it
  is waiting for its full-screen UI. Add `--ui=stream`. In a normal terminal you won't see this.
- **Committing `.env`.** `git status` must not list it. If it does, the `.gitignore` copy failed.
- **An `AGENTS.md` appears in the repo root.** Turbo writes it when it detects an AI agent running
  commands. It's harmless; delete it, or add `"agentGuidance": false` to `turbo.json` if it keeps
  coming back.

## 10. Interview prep

**Q: Why a monorepo for a project this small?**
A: Two apps and a widget all depend on the same request and event shapes. With a shared Zod package
the API validates with the exact schema the frontend's types come from, so a change to a field is a
compile error in both places instead of a runtime 400. Turborepo then builds only what changed and
in the right order.

**Q: What does `^build` mean in `turbo.json`?**
A: "Run `build` in my workspace dependencies first." The API consumes `@repo/types` from its
compiled output, so typecheck, lint and tests on the API need that build to exist. Turbo also
caches the result, so the second run is near-instant.

**Q: Your TypeScript compiles fine but Node says `ERR_MODULE_NOT_FOUND`. Why?**
A: ES modules resolve paths literally and TypeScript doesn't add extensions. An import of `./env`
stays `./env` in the output and there is no such file, only `env.js`. Using `NodeNext` resolution
makes the compiler require `./env.js` in the source, so the output is correct. I hit exactly this in
an earlier project's build.

**Q: Why `noeviction` on Redis?**
A: This Redis holds a job queue. Under memory pressure an evicting policy would silently delete jobs;
`noeviction` turns that into a visible write error instead. A cache would want the opposite policy,
which is why projects that have both run two instances.

**Q: Why pin TypeScript to 5.9.3 instead of the latest?**
A: The lint toolchain supports up to 6.0, and one pinned compiler across every package and CI means
"it typechecks on my machine" is the same statement as "it typechecks in CI".

## 11. Resume-safe claim

"Set up a pnpm + Turborepo TypeScript monorepo with a shared Zod schema package consumed by the API
and frontend, cached builds, and a Docker Compose environment for Postgres/pgvector and Redis."

(No numbers in this phase.)

## 12. Definition of done

- [ ] `pnpm install` succeeds and `pnpm-lock.yaml` is committed
- [ ] `pnpm build`, `pnpm typecheck`, `pnpm lint` and `pnpm format:check` all pass from the root
- [ ] A second `pnpm build` reports FULL TURBO
- [ ] `node apps/api/dist/index.js` prints `valid uuid: true, invalid uuid: false`
- [ ] Removing a `.js` suffix makes the build fail with TS2835 (then restored)
- [ ] `docker compose up -d --wait` brings up both services healthy
- [ ] The `vector` extension is listed as available; Redis reports `noeviction` and `appendonly yes`
- [ ] `apps/api/.env` exists and is not tracked by git
- [ ] I can explain every row of the dependency table below

---

## Appendix — Every package in the project, by the phase that first uses it

All versions were checked with `pnpm view <pkg> version` on 6 October 2026. Where a newer major
exists but the version below is older, the reason is given. **Do not install a phase's packages
before that phase**; its first step repeats the exact `pnpm add` line.

"Flagged" means the package is not named in the project spec and was approved because of the reason
given.

### Root (`counseldesk`) — Phase 00

| Package      | Version | Type | Why                                                                   |
| ------------ | ------- | ---- | --------------------------------------------------------------------- |
| `turbo`      | ^2.11.7 | dev  | Runs tasks across packages in dependency order, with caching          |
| `prettier`   | ^3.9.9  | dev  | One code style; `format` / `format:check`                             |
| `typescript` | 5.9.3   | dev  | One compiler for the repo (7.x is not supported by typescript-eslint) |

### `packages/eslint-config` — Phase 00

| Package                     | Version | Why                                                          |
| --------------------------- | ------- | ------------------------------------------------------------ |
| `eslint`                    | ^9.39.5 | The linter (10.x exists; copied config targets 9)            |
| `@eslint/js`                | ^9.39.5 | ESLint's recommended JS rules                                |
| `typescript-eslint`         | ^8.71.1 | TypeScript parser + rules                                    |
| `eslint-config-prettier`    | ^10.1.8 | Turns off rules that fight Prettier                          |
| `eslint-plugin-only-warn`   | ^1.2.1  | Rules warn instead of error                                  |
| `eslint-plugin-turbo`       | ^2.11.7 | Warns on env vars Turbo doesn't know about                   |
| `eslint-plugin-react`       | ^7.37.5 | React rules (used by `next.js` config, Phase 31)             |
| `eslint-plugin-react-hooks` | ^5.2.0  | Hooks rules (7.x exists; copied config targets 5)            |
| `@next/eslint-plugin-next`  | ^16.3.8 | Next.js rules, matches `next` 16.3.8                         |
| `globals`                   | ^16.5.0 | Global variable sets (17.x exists; copied config targets 16) |
| `typescript`                | 5.9.3   | Peer of typescript-eslint                                    |

### `packages/types` (`@repo/types`) — Phase 00

| Package                                  | Version  | Type | Why                                   |
| ---------------------------------------- | -------- | ---- | ------------------------------------- |
| `zod`                                    | ^4.6.5   | dep  | Shared request/response/event schemas |
| `typescript`, `eslint`, `@repo/*-config` | as above | dev  | Build and lint                        |

### `packages/content` (`@repo/content`) — Phase 10

The firm's markdown pages plus the loader and heading slug function, shared by the API (ingestion)
and the website (rendering), so a citation link and the page anchor are generated by the same code.
No runtime dependencies (Node's `fs` and `path`). Dev: `typescript`, `eslint`, `vitest`.

### `apps/api` (`api`)

| Phase | Package                                                 | Version                  | Type | Why                                                                                  |
| ----- | ------------------------------------------------------- | ------------------------ | ---- | ------------------------------------------------------------------------------------ |
| 00    | `@repo/types`                                           | workspace                | dep  | Shared schemas                                                                       |
| 00    | `tsx`                                                   | ^4.23.15                 | dev  | Runs TypeScript directly in dev (`tsx watch`)                                        |
| 00    | `@types/node`                                           | ^22.20.5                 | dev  | Node 22 types                                                                        |
| 00    | `typescript`, `eslint`, `@repo/*-config`                | as above                 | dev  | Build and lint                                                                       |
| 01    | `express`                                               | ^5.2.1                   | dep  | HTTP server (as e-commerce)                                                          |
| 01    | `helmet`                                                | ^8.3.0                   | dep  | Security headers                                                                     |
| 01    | `cors`                                                  | ^2.8.6                   | dep  | Origin allowlist with credentials                                                    |
| 01    | `cookie-parser`                                         | ^1.4.7                   | dep  | Reads the auth cookies (Phase 06)                                                    |
| 01    | `dotenv`                                                | ^17.4.2                  | dep  | Loads `.env` (18.x exists; e-commerce and Prisma's CLI use 17)                       |
| 01    | `zod`                                                   | ^4.6.5                   | dep  | Validation in controllers                                                            |
| 01    | `@types/express`, `@types/cors`, `@types/cookie-parser` | ^5.0.6, ^2.8.19, ^1.4.10 | dev  | Types                                                                                |
| 03    | `@prisma/orm-postgres`                                  | 8.0.0-rc.14 (exact)      | dep  | Prisma 8 runtime, as the e-commerce port                                             |
| 03    | `@prisma/orm-extension-pgvector`                        | 8.0.0-rc.14 (exact)      | dep  | **Flagged.** The `vector` column type for Prisma 8                                   |
| 03    | `@prisma/cli-engine`                                    | 0.6.2 (exact)            | dep  | `prisma.config.ts` helper, the version the CLI below ships with                      |
| 03    | `pg`                                                    | ^8.23.1                  | dep  | The shared connection pool for hand-written SQL (search, RRF)                        |
| 03    | `prisma`                                                | 8.0.0-rc.20 (exact)      | dev  | The CLI; rc.20 is built against the rc.14 runtime above                              |
| 03    | `@types/pg`                                             | ^8.23.1                  | dev  | Types                                                                                |
| 06    | `bcrypt`                                                | ^6.0.0                   | dep  | Staff password hashing                                                               |
| 06    | `jsonwebtoken`                                          | ^9.0.3                   | dep  | Access/refresh tokens                                                                |
| 06    | `@types/bcrypt`, `@types/jsonwebtoken`                  | ^6.0.0, ^9.0.10          | dev  | Types                                                                                |
| 08    | `ioredis`                                               | ^5.11.1                  | dep  | Redis client (6.x exists; the copied limiter is written against 5)                   |
| 08    | `proxy-addr`                                            | ^2.0.8                   | dep  | Trusted-proxy client IP (copied `ipExtractor.ts`)                                    |
| 08    | `ipaddr.js`                                             | ^2.5.0                   | dep  | CIDR matching (copied `ipExtractor.ts`)                                              |
| 08    | `@types/proxy-addr`                                     | ^2.0.3                   | dev  | Types                                                                                |
| 09    | `bullmq`                                                | ^5.81.5                  | dep  | Job queue (6.x exists; copied queue code targets 5)                                  |
| 09    | `@bull-board/api`, `@bull-board/express`                | ^8.6.1                   | dep  | Queue dashboard (9.x exists; copied wiring targets 8)                                |
| 09    | `resend`                                                | ^4.8.0                   | dep  | Email delivery (6.x exists; copied mail code targets 4)                              |
| 10    | `vitest`                                                | ^5.0.3                   | dev  | Unit tests (spec: "Vitest or Jest"; Vitest runs ESM TypeScript with no extra setup)  |
| 11    | `@google/genai`                                         | ^2.27.0                  | dep  | Gemini embeddings and chat (the current SDK; `@google/generative-ai` is the old one) |
| 14    | `groq-sdk`                                              | ^1.6.0                   | dep  | Groq fallback model                                                                  |

Peer dependency installed automatically by pnpm in Phase 03: `temporal-polyfill` (^1.0.4, required
by `@prisma/orm-postgres`). Phases 25–26 add no packages: integration tests start the app on a
random port and use Node's built-in `fetch`, so `supertest` is not needed. The pgvector _npm_
package is also not needed: a vector is sent to SQL as the string `[0.1,0.2,…]`, which is one line.

### `apps/web` (Next.js: demo firm site + staff page)

| Phase | Package                                                 | Version   | Type | Why                                                                        |
| ----- | ------------------------------------------------------- | --------- | ---- | -------------------------------------------------------------------------- |
| 31    | `next`                                                  | ^16.3.8   | dep  | Framework (spec)                                                           |
| 31    | `react`, `react-dom`                                    | ^19.3.0   | dep  | UI                                                                         |
| 31    | `@repo/types`                                           | workspace | dep  | Shared schemas                                                             |
| 31    | `tailwindcss`, `@tailwindcss/postcss`                   | ^4.3.3    | dev  | Styling, as e-commerce                                                     |
| 31    | `@types/react`, `@types/react-dom`                      | ^19.3.0   | dev  | Types                                                                      |
| 31    | `@types/node`, `typescript`, `eslint`, `@repo/*-config` | as above  | dev  | Build and lint                                                             |
| 32    | `react-markdown`                                        | ^10.1.0   | dep  | **Flagged.** Renders the firm's markdown pages with custom heading anchors |
| 35    | `axios`                                                 | ^1.20.0   | dep  | HTTP client with the silent-refresh interceptor (copied from e-commerce)   |
| 35    | `@tanstack/react-query`                                 | ^5.104.1  | dep  | Server data, as e-commerce                                                 |
| 35    | `zustand`                                               | ^5.0.15   | dep  | Auth state, as e-commerce                                                  |
| 38    | `@playwright/test`                                      | ^1.63.0   | dev  | **Flagged.** End-to-end tests (also an optional peer of Next.js)           |

### `apps/widget` (embeddable chat script)

| Phase | Package                                  | Version  | Type | Why                                                                     |
| ----- | ---------------------------------------- | -------- | ---- | ----------------------------------------------------------------------- |
| 33    | `vite`                                   | ^8.3.3   | dev  | **Flagged.** Library-mode build to one script file; you already know it |
| 33    | `typescript`, `eslint`, `@repo/*-config` | as above | dev  | Build and lint                                                          |

The widget has **no runtime dependencies**: plain TypeScript and the DOM keep the script small enough
to drop onto any page.
