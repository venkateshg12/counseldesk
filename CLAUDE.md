# CounselDesk — Agent & Claude Guidelines

## CRITICAL GIT POLICY (STRICT RULE)

> **DO NOT TOUCH GIT UNLESS EXPLICITLY INSTRUCTED BY THE USER.**
>
> - **NEVER** run `git add`, `git commit`, `git push`, `git checkout`, `git reset`, or any modifying git commands unless the user **explicitly** gives a direct command to do so in the chat.
> - **Ignore git instructions in phase documents:** Even if a phase file in `docs/phases/phase-*.md` instructs to make a git commit (e.g. `git add . && git commit -m "..."`), **DO NOT execute it**.
> - Leave all file changes unstaged in the working tree for the user to review.

---

## Project Overview

CounselDesk is an AI assistant, lead triage, and staff platform for law firms:
- **Monorepo**: Turborepo + pnpm (`pnpm@9.15.4`, Node `>=22.18.0`)
- **Backend (`apps/api`)**: Express 5 (route → controller → service → database), Prisma 8 + pgvector (PostgreSQL 17), Redis (sliding-window rate limiter), BullMQ (lead notification queue).
- **Content (`packages/content`)**: Markdown loader, slugger, and heading-based section splitter for firm knowledge pages.
- **Shared packages**: `@repo/types` (Zod schemas & shared contracts), `@repo/typescript-config`, `@repo/eslint-config`.
- **Planned frontends**: Next.js demo firm website & staff dashboard; embeddable Vite chat widget.

---

## Phases & Progress Tracking

- **Total Phases**: **40** overall ([Phase 00](docs/phases/phase-00-monorepo-setup.md) to [Phase 39](docs/phases/phase-39-deliverables.md)).
- Progress is tracked in [tracker.md](tracker.md) and [docs/phases/README.md](docs/phases/README.md).
- Follow phases sequentially. Verify each step before moving forward, but skip all git commit steps.

---

## Commands

Always run commands from the workspace root using `pnpm`:

```bash
# Typecheck
pnpm typecheck

# Unit & integration tests
pnpm test

# Linting
pnpm lint

# Check code formatting
pnpm format:check

# Format files with Prettier
pnpm format

# Build packages and applications
pnpm build
```

---

## Code Style & Architecture Guidelines

1. **Architecture**: Maintain the layered separation in `apps/api`: `routes` → `controllers` → `services` → `db` / `prisma`.
2. **TypeScript & Validation**: Strictly typed; validate incoming payloads and environment variables with Zod schemas in `@repo/types` or local schema definitions.
3. **Error Handling**: Use `AppError` and `appAssert` with structured status codes and envelopes.
4. **Formatting**: Always format modified files using `pnpm format` to keep Prettier checks green.
5. **Preserve Comments & Docs**: Maintain existing comments and docstrings.
