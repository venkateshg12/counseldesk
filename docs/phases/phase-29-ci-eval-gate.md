# Phase 29 — The CI eval gate

## 1. Goal

On every push, run the 11-case CI subset of the golden set against the real models and **fail the
build** if quality drops below the thresholds from your baseline (Phase 22's `thresholds.ts`). The
report appears on the workflow run's summary page and as a downloadable artefact.

This is the spec's "a small part of this suite runs automatically on every GitHub push".

## 2. What I will understand after this phase

1. Why the eval gate is a separate workflow from the test CI.
2. How GitHub secrets reach a job, and why forks don't get them.
3. How to set thresholds that catch regressions without flaking on noise.
4. What the gate costs per run, in calls and time.

## 3. Prerequisites

- Phase 28 done; two baseline runs and thresholds set from them (Phases 22–23).
- Repository secrets added (Settings → Secrets and variables → Actions):
  `GEMINI_API_KEY`, `GROQ_API_KEY`. Repository **variables** (not secret):
  `GEMINI_CHAT_MODEL`, `GEMINI_EMBEDDING_MODEL`, `GROQ_CHAT_MODEL`.

## 4. Files

```
.github/workflows/evals.yml        NEW
```

## 5. Concepts

**Why separate.** The test CI (Phase 28) needs no secrets and spends nothing; it runs for everyone,
including forks. The eval gate needs real API keys, spends quota, takes a few minutes and is slightly
noisy. Keeping it in its own workflow means a fork's pull request still gets full test feedback, and the
gate's runs can be limited and retried independently.

**Secrets and forks.** GitHub passes repository secrets to workflows triggered from the repository
itself, not to workflows triggered by pull requests from forks. The workflow checks whether the key is
present and skips the gate (with a notice) instead of failing for contributors who can't have it.

**Thresholds against noise.** A gate set at your baseline's exact numbers fails half the time, because
runs vary. Set each threshold at baseline minus the noise floor you measured (Phase 22), and hold
refusals at 100% — that one must never regress. With 11 cases, one case is ~9 points: the CI gate is a
smoke alarm for big regressions (a broken prompt, a dead retrieval path), not a precise measurement.
The full 57-case run is the measurement.

**Cost.** Per run: ingestion (~5 embedding requests for ~100 sections — the CI database starts empty
each time) plus 11 cases × ~2–3 model calls. A few dozen calls per push, well within free-tier daily
limits for a personal project; the job summary prints the token total so you can watch it.

## 6. Steps

### `.github/workflows/evals.yml`

```yaml
name: evals

on:
  push:
  workflow_dispatch:

concurrency:
  group: evals-${{ github.ref }}
  cancel-in-progress: true

jobs:
  eval-gate:
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

    env:
      NODE_ENV: test
      PORT: "4000"
      CORS_ORIGIN: http://localhost:3000
      LOG_LEVEL: warn
      DATABASE_URL: postgresql://counseldesk:counseldesk@localhost:5433/counseldesk
      REDIS_HOST: localhost
      REDIS_PORT: "6381"
      # Throwaway values: this job never issues a token anyone uses.
      JWT_SECRET: ci-access-secret-0123456789abcdef0123456789abcdef
      JWT_REFRESH_SECRET: ci-refresh-secret-0123456789abcdef0123456789abcd
      STAFF_NOTIFY_EMAIL: staff@ci.local
      SITE_URL: http://localhost:3000
      GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
      GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
      GEMINI_CHAT_MODEL: ${{ vars.GEMINI_CHAT_MODEL }}
      GEMINI_EMBEDDING_MODEL: ${{ vars.GEMINI_EMBEDDING_MODEL }}
      GROQ_CHAT_MODEL: ${{ vars.GROQ_CHAT_MODEL }}

    steps:
      - name: Skip without secrets (forks)
        id: secrets
        run: |
          if [ -z "$GEMINI_API_KEY" ]; then
            echo "::notice::GEMINI_API_KEY not available; skipping the eval gate."
            echo "present=false" >> "$GITHUB_OUTPUT"
          else
            echo "present=true" >> "$GITHUB_OUTPUT"
          fi

      - uses: actions/checkout@v4
        if: steps.secrets.outputs.present == 'true'

      - uses: pnpm/action-setup@v4
        if: steps.secrets.outputs.present == 'true'

      - uses: actions/setup-node@v4
        if: steps.secrets.outputs.present == 'true'
        with:
          node-version: 22
          cache: pnpm

      - name: Install, build, migrate, ingest
        if: steps.secrets.outputs.present == 'true'
        run: |
          pnpm install --frozen-lockfile
          pnpm turbo run build --filter=api --ui=stream
          pnpm --filter api db:migrate
          pnpm --filter api ingest

      - name: Eval gate (CI subset)
        if: steps.secrets.outputs.present == 'true'
        run: pnpm --filter api eval --label "ci-${GITHUB_SHA::7}" --subset ci --gate

      # The folder also holds committed reports from earlier experiments; publish only this run's.
      - name: Publish report
        if: always() && steps.secrets.outputs.present == 'true'
        run: cat "$(ls -t apps/api/evals/results/*.md | head -1)" >> "$GITHUB_STEP_SUMMARY"

      - uses: actions/upload-artifact@v4
        if: always() && steps.secrets.outputs.present == 'true'
        with:
          name: eval-report
          path: apps/api/evals/results/*ci-*
```

- Every step after the check is conditional, so a fork's run is green with a notice instead of red.
- Secrets are referenced only in `env`; GitHub masks their values in logs.
- `if: always()` on the report steps: when the gate fails, you most need to see why.
- `${GITHUB_SHA::7}` labels the run with the short commit hash, so reports map to commits.
- The CI database starts empty, so it's migrated and ingested each run. That also tests that a fresh
  database can be built from the repo alone.

### Thresholds

Open `apps/api/src/evals/thresholds.ts` and set each value to (your worst baseline result on the
**CI subset**) minus one case's worth (~0.09 for 11 cases), keeping `refusalRate: 1`. Run the subset
locally twice first:

```bash
pnpm --filter api eval --label ci-local-1 --subset ci --gate
pnpm --filter api eval --label ci-local-2 --subset ci --gate
```

Both must pass locally before the gate goes on.

## 7. Commit points

1. `ci: add eval gate workflow on the ci subset with report artefact`
2. `chore(evals): set ci thresholds from measured baselines`

## 8. Verify

- Push to a branch: the `evals` workflow runs, the summary page shows the metrics table, the artefact
  contains `.md` and `.json`.
- Break something on a throwaway branch — e.g. change the router prompt to always answer
  `"question"` — and push: the gate fails with `GATE: refusalRate …`.
- Open a pull request from a fork (or temporarily rename the secret): the workflow passes with the
  "skipping the eval gate" notice.

## 9. Common mistakes

- **Thresholds equal to the baseline.** The gate flakes, you start ignoring it, and then it's worthless.
- **Running the full 57 cases on every push.** Slow and quota-hungry; the full set is for experiments.
- **Secrets in `run:` lines** (`echo $GEMINI_API_KEY` for debugging). Masking helps, but don't.
- **Making the gate required for merging forks' PRs.** It can't run for them; require only `ci`.

## 10. Interview prep

**Q: How do you stop quality regressions from merging?**
A: A CI job runs a fixed subset of the golden evals against the real models on every push and fails
when any metric falls below thresholds set from measured baselines minus noise; refusal accuracy must
stay at 100%. The report is attached to the run.

**Q: Isn't an LLM gate flaky?**
A: It can be, which is why thresholds include a noise margin measured from repeated baselines and the
gate covers coarse regressions; precise comparisons use the full set, run repeatedly.

## 11. Resume-safe claim

"Added a CI evaluation gate that runs a golden-set subset against live models on every push and blocks
regressions in routing, refusals, retrieval and citations."

## 12. Definition of done

- [ ] The `evals` workflow runs on push, publishes the report, and passes on `main`
- [ ] A deliberately broken router fails the gate
- [ ] Runs without secrets skip with a notice instead of failing
- [ ] Thresholds are derived from recorded baselines, with the derivation noted in `docs/results.md`
