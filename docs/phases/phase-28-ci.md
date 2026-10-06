# Phase 28 — CI: lint, typecheck, unit and integration tests on every push

## 1. Goal

A GitHub Actions workflow that runs on every pull request and every push to `main`:
install with a frozen lockfile → build → typecheck → **lint as a gate** → unit tests → integration tests
against real Postgres (pgvector) and Redis service containers, with the fake LLM.

It starts from the workflow you already wrote for e-commerce (`.github/workflows/ci.yml`), adds service
containers and tests, and makes lint blocking from day one — this codebase starts clean, so it can stay
clean.

## 2. What I will understand after this phase

1. What a CI service container is and how the job reaches it.
2. Why integration tests can run in CI without any secrets.
3. Why the lockfile is installed frozen, and why that catches a class of deploy failures early.
4. Why `--affected` runs on pull requests and the full suite on `main`.

## 3. Prerequisites

- Phase 27 done.
- The repo pushed to GitHub (`git remote add origin …`).

## 4. Files

```
.github/workflows/ci.yml          ADAPT  e-commerce/.github/workflows/ci.yml
apps/api/package.json             (no change; scripts already exist)
```

## 5. Concepts

**Service containers.** A job can declare `services:` — Docker containers GitHub starts next to the
job and stops after it. With `ports:` mapped, the job reaches them on `localhost`. The workflow uses
the same `pgvector/pgvector:0.8.7-pg17` and `redis:7.4` images as Compose, so CI tests what you run
locally.

**No secrets needed.** Integration tests use the fake LLM (Phase 25) and throwaway credentials from
`.env.test`. A pull request from a fork — where GitHub withholds repository secrets — runs the full
test suite. Only the eval gate (Phase 29) needs real API keys, so it lives in a separate job.

**Frozen lockfile.** `pnpm install --frozen-lockfile` fails if `package.json` and `pnpm-lock.yaml`
disagree. You've seen what happens otherwise: in e-commerce a `package.json` change committed
without its lockfile broke the Render deploy. CI catches it on the pull request instead.

**`--affected`.** On a pull request, Turbo compares against `main` and only runs tasks for packages
that changed (and their dependents): a docs change runs nothing heavy. Pushes to `main` run
everything, as a full check of what's about to deploy. This needs the git history, hence
`fetch-depth: 0`. (Same as the e-commerce workflow.)

## 6. Steps

### `.github/workflows/ci.yml`

ADAPT the e-commerce workflow. Kept: triggers, concurrency group, checkout with full history, pnpm and
Node 22 setup with the pnpm cache, frozen install, affected-on-PR / full-on-main. Changed: lint is a
gate (no `continue-on-error`), no excluded packages, services and test steps added.

```yaml
name: ci

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

# A newer push to the same branch makes the older run pointless.
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  ci:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    services:
      postgres:
        image: pgvector/pgvector:0.8.7-pg17
        env:
          POSTGRES_USER: counseldesk
          POSTGRES_PASSWORD: counseldesk
          POSTGRES_DB: counseldesk
        ports:
          - 5433:5432
        options: >-
          --health-cmd "pg_isready -U counseldesk -d counseldesk"
          --health-interval 5s --health-timeout 3s --health-retries 10
      redis:
        image: redis:7.4
        ports:
          - 6381:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s --health-timeout 3s --health-retries 10

    steps:
      - uses: actions/checkout@v4
        with:
          # `turbo --affected` diffs against the base branch, so it needs the history.
          fetch-depth: 0

      # Reads the version from "packageManager" in the root package.json.
      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Choose scope
        id: scope
        run: |
          if [ "${{ github.event_name }}" = "pull_request" ]; then
            echo "args=--affected" >> "$GITHUB_OUTPUT"
          else
            echo "args=" >> "$GITHUB_OUTPUT"
          fi

      - name: Build, typecheck, lint, unit tests
        run: pnpm turbo run build typecheck lint test ${{ steps.scope.outputs.args }} --ui=stream

      # Real Postgres + Redis from the services above, fake LLM, throwaway secrets from .env.test.
      - name: Integration tests
        run: pnpm --filter api test:integration
```

Ports match `.env.test` (5433 and 6381), so the tests need no CI-specific configuration.

Why integration tests aren't under `--affected`: they're one command and the API is what almost every
change touches; running them always keeps the rule simple. If they ever get slow, move them behind
the same affected check.

### Make lint fail the build

The shared ESLint config uses `eslint-plugin-only-warn`, which turns every error into a warning, and
ESLint exits 0 on warnings. To make lint a real gate, add `--max-warnings=0` to each package's lint
script:

```json
"lint": "eslint . --max-warnings=0"
```

(in `apps/api`, `packages/types`, `packages/content`, and later `apps/web` and `apps/widget`). Fix
whatever it reports now, while the codebase is small.

### Branch protection (GitHub settings, manual)

Settings → Branches → add a rule for `main`: require the `ci` check to pass before merging. Then work
on branches and merge through pull requests. (You can still push directly to `main` as the owner if you
don't tick "include administrators"; the check still runs.)

## 7. Commit points

1. `ci: run build, typecheck, lint and unit tests with turbo`
2. `ci: run integration tests against postgres and redis service containers`
3. `chore: make lint a gate with --max-warnings=0`

## 8. Verify

```bash
# Locally, the same commands CI runs:
pnpm turbo run build typecheck lint test --ui=stream
pnpm --filter api test:integration
```

On GitHub:

- Push a branch and open a pull request: the `ci` job runs; the Postgres and Redis services start
  healthy; all steps green.
- Prove the gates work, each on a throwaway branch:
  - add an unused variable → lint step fails;
  - change a `package.json` dependency without updating the lockfile → install step fails;
  - break a test → the test step fails.
- A pull request touching only `docs/` runs Turbo with `--affected` and finishes quickly.

## 9. Common mistakes

- **Service ports that don't match `.env.test`.** Tests time out connecting to nothing.
- **Lint "passing" with warnings.** Without `--max-warnings=0`, `only-warn` makes lint unable to fail.
- **Putting the eval gate in this job.** Forks can't run it (no secrets) and every PR would spend model
  quota. It's a separate job (Phase 29).
- **Caching `node_modules` by hand.** `setup-node`'s `cache: pnpm` caches pnpm's store correctly; caching
  `node_modules` across lockfile changes causes ghost failures.

## 10. Interview prep

**Q: What does your CI run?**
A: On every PR and push: frozen install, build, typecheck, lint as a gate, unit tests, then integration
tests against real Postgres-with-pgvector and Redis service containers using a fake LLM, so it needs no
secrets and works for forks. PRs only run affected packages; main runs everything.

**Q: How did CI prevent a real failure?**
A: Frozen-lockfile install fails when a dependency change isn't reflected in the lockfile — the same
mistake that broke a deploy in an earlier project, now caught on the PR.

## 11. Resume-safe claim

"Set up GitHub Actions CI with Turbo-affected builds, lint/type gates, and integration tests against
Postgres/pgvector and Redis service containers."

## 12. Definition of done

- [ ] The workflow is green on a pull request and on `main`
- [ ] Lint, lockfile and test failures each make it red (tested on throwaway branches)
- [ ] Branch protection requires `ci`
