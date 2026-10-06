# CounselDesk — build phases

Follow the phases in order. Each one leaves the app runnable and ends with a Verify section and a
Definition of done. Tick a phase only when every box in its Definition of done is ticked.

Reference project (read-only): `~/Code/e-commerce`. Every COPY / ADAPT tag in a phase file names
the exact source path there.

## How these plans were checked

- **Phase 00** was dry-run end to end on a throwaway copy (install, build, typecheck, lint, format,
  Turbo cache, the compiled ESM API, Docker Compose services) before it was written.
- **Code later run in that throwaway copy:** the content splitter and slug tests (Phase 10), Reciprocal
  Rank Fusion tests (Phase 13), the LLM provider layer type-checked against the real Gemini and Groq
  SDKs (Phases 14 and 18), citation tests (Phase 15), the golden dataset's shape and anchors (Phase
  21), the eval metrics tests (Phase 22), the multi-stage Docker build (Phase 27), and the widget's
  tests, typecheck, lint and build (Phase 33).
- **Everything else** is written against current docs and verified package versions, but not executed
  as a whole project. When a command's output differs from a phase's Verify section, investigate the
  difference — especially around Prisma 8, which is a release candidate.
- Package versions were checked with `pnpm view` on 6 October 2026; model ids and prices against the
  providers' docs on the same date.

## Decisions fixed at Gate A

| Decision | Result                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend  | Express 5, route → controller → service → database, as e-commerce                                                                            |
| Database | Postgres 17 + pgvector, Prisma 8 (release candidate) like the e-commerce Postgres port; search SQL hand-written through the shared `pg` pool |
| Frontend | Next.js (demo firm site + staff page); the chat widget is a separate Vite-built script                                                       |
| Extras   | Lead-notification email through BullMQ + Resend (Phase 09). No response cache, no multi-firm tenancy, no Pinecone                            |
| Auth     | Staff only (seeded accounts); `authenticate` checks the live session; no separate role guard                                                 |
| Tests    | Vitest; small unit tests in the phase that writes a pure function, integration tests in Phases 25–26, Playwright E2E in Phase 38             |

## Status

### Foundation

- [ ] 00 — [Monorepo setup](phase-00-monorepo-setup.md)
- [ ] 01 — [API bootstrap: env, errors, envelope, error handler, health, shutdown](phase-01-api-bootstrap.md)
- [ ] 02 — [Structured logging and request ids](phase-02-logging-request-ids.md)

### Database

- [ ] 03 — [Prisma 8 + pgvector wiring, the page table](phase-03-prisma-pgvector.md)
- [ ] 04 — [Sections: the vector column and the full-text index](phase-04-content-schema.md)
- [ ] 05 — [App schema: conversations, messages, citations, leads, handoffs, LLM calls](phase-05-app-schema.md)

### Staff auth and protection

- [ ] 06 — [Staff accounts: login and logout](phase-06-staff-login.md)
- [ ] 07 — [Refresh rotation, `authenticate` and `/auth/me`](phase-07-sessions-and-guards.md)
- [ ] 08 — [Redis and rate limiting](phase-08-rate-limiting.md)
- [ ] 09 — [Lead notification email through BullMQ](phase-09-lead-email-queue.md)

### Retrieval

- [ ] 10 — [The firm's content and the heading splitter](phase-10-content-and-splitter.md)
- [ ] 11 — [Embeddings and idempotent ingestion](phase-11-embeddings-ingestion.md)
- [ ] 12 — [Keyword search and vector search](phase-12-keyword-and-vector-search.md)
- [ ] 13 — [Hybrid search with Reciprocal Rank Fusion](phase-13-hybrid-rrf.md)

### Generation

- [ ] 14 — [LLM provider adapter: Gemini, Groq, timeouts, retries, fallback](phase-14-llm-provider-adapter.md)
- [ ] 15 — [Versioned prompts and grounded answers with citations](phase-15-prompts-grounded-answers.md)
- [ ] 16 — [The streaming chat endpoint (SSE)](phase-16-sse-chat-endpoint.md)
- [ ] 17 — [Guardrails: intent router, refusals, disclaimer](phase-17-guardrails-router.md)
- [ ] 18 — [Tools: createLead and requestHumanHandoff](phase-18-tools-lead-handoff.md)
- [ ] 19 — [Staff API: leads, handoff queue, transcripts](phase-19-staff-api.md)
- [ ] 20 — [Observability: cost, tokens, latency, traces](phase-20-observability.md)

### Evals

- [ ] 21 — [The golden dataset](phase-21-golden-dataset.md)
- [ ] 22 — [The eval runner and scoring](phase-22-eval-runner.md)
- [ ] 23 — [Experiments: one change at a time](phase-23-experiments.md)

### Hardening and delivery

- [ ] 24 — [Security: prompt injection, personal data, input limits, CORS](phase-24-security.md)
- [ ] 25 — [Test harness: test database, fake LLM, helpers](phase-25-test-harness.md)
- [ ] 26 — [Integration tests](phase-26-integration-tests.md)
- [ ] 27 — [API Dockerfile and the full Compose stack](phase-27-docker.md)
- [ ] 28 — [CI: lint, typecheck, unit and integration tests](phase-28-ci.md)
- [ ] 29 — [The CI eval gate](phase-29-ci-eval-gate.md)
- [ ] 30 — [Deploy the API](phase-30-deploy-api.md)

### Frontend

- [ ] 31 — [Next.js app setup](phase-31-nextjs-setup.md)
- [ ] 32 — [The demo law-firm website](phase-32-demo-site.md)
- [ ] 33 — [The chat widget: core](phase-33-widget-core.md)
- [ ] 34 — [Widget flows: notices, errors, cold starts](phase-34-widget-flows.md)
- [ ] 35 — [Staff app: silent refresh, login, protected routes](phase-35-staff-auth-ui.md)
- [ ] 36 — [Staff screens: leads, handoff queue, transcripts, metrics](phase-36-staff-screens.md)
- [ ] 37 — [Polish, the cross-site cookie fix, deploying the site](phase-37-polish-and-deploy-site.md)
- [ ] 38 — [End-to-end tests](phase-38-e2e-tests.md)

### Finish

- [ ] 39 — [Deliverables: README, architecture, results, known failures, demo video](phase-39-deliverables.md)
