# Phase 37 — Polish, the cross-site cookie fix, and deploying the site

## 1. Goal

Ship the frontend: deploy `apps/web` (site, staff pages, widget file) on Vercel, solve the cross-site
cookie problem from Phase 35 so login and conversations work in every browser, add the web app to the
local Compose stack, and do a focused polish pass — accessibility, mobile, error pages, metadata — with
measurable targets.

## 2. What I will understand after this phase

1. The difference between "same-origin" and "same-site", and why it decides whether cookies work.
2. The trade-offs of the two fixes (one domain vs a same-origin proxy), including what a proxy does to
   IP-based rate limiting.
3. How Vercel builds one app out of a pnpm + Turbo monorepo.
4. How to verify accessibility with numbers instead of impressions.

## 3. Prerequisites

- Phase 36 done; the API deployed (Phase 30).

## 4. Files

```
Dockerfile                                   (web stage)
docker-compose.yml                           (web service)
apps/web/next.config.ts                      (proxy rewrite — option B only)
apps/web/src/app/staff/(protected)/error.tsx NEW
apps/web/src/app/icon.svg                    NEW
apps/api/src/constants/env.ts                (PUBLIC_PATH_PREFIX — option B only)
apps/api/src/utils/auth/cookies.ts           (refresh cookie path — option B only)
docs/deploy.md                               (site section)
```

## 5. Concepts

**Origin vs site.** An _origin_ is scheme + host + port (`https://app.example.com`). A _site_ is scheme +
registrable domain (`https://example.com`): `app.example.com` and `api.example.com` are different
origins but the **same site**. Browsers' third-party cookie blocking is about _sites_. `vercel.app` and
`onrender.com` are different sites — and both are on the Public Suffix List, so even
`a.vercel.app` and `b.vercel.app` are different sites.

**Fix A — one site (recommended if you have a domain).** Point `example.com` (or `www.`) at Vercel and
`api.example.com` at Render. The cookies are then first-party, nothing else changes, and the API still
sees each visitor's real IP. Costs a domain name (~$10/year).

**Fix B — same-origin proxy (free).** The browser talks only to the site's origin; Next rewrites
`/api/*` to the API server-side. Cookies are first-party. Costs:

- the refresh cookie's `Path` must include the `/api` prefix the browser sees;
- the API now sees **Vercel's** address as the client, not the visitor's, so IP-based limits apply to
  everyone at once. The per-visitor cookie buckets still work; the IP buckets must be loosened or
  replaced by visitor keys for the chat. That's a real weakening — state it in the README;
- streaming through the rewrite must be verified (Step 4); if a proxy buffers SSE, answers arrive all at
  once.

**Measured polish.** "Looks fine on my laptop" isn't a target. Lighthouse gives accessibility and
performance scores per page; the targets here are ≥ 95 accessibility on the home page and the leads
page, and zero axe violations in the widget (Phase 38 automates the latter).

## 6. Steps

### Step 1 — Deploy the site on Vercel

New project → import the repo:

| Setting                                                                              | Value                                                                                                           |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Root Directory                                                                       | `apps/web`                                                                                                      |
| Include files outside the root directory                                             | **On** (needs `packages/*` and `apps/widget`)                                                                   |
| Build Command                                                                        | `cd ../.. && pnpm turbo run build --filter=web --ui=stream`                                                     |
| Install Command                                                                      | (default: Vercel detects pnpm from the lockfile and installs the workspace)                                     |
| Skip deployments when there are no changes to the root directory or its dependencies | **On**                                                                                                          |
| Environment                                                                          | `NEXT_PUBLIC_API_URL=https://<your-api>.onrender.com` (option A: `https://api.<your-domain>`; option B: `/api`) |

The custom build command runs Turbo from the repo root, so `^build` builds `@repo/types`,
`@repo/content` and the **widget** before the site — the site's `prebuild` then copies the widget file
into `public/`. Without it, Vercel would run `next build` alone and the widget would be missing.

Then update the API's environment on Render: `CORS_ORIGIN`, `SITE_URL` and `STAFF_APP_URL` → the site's
real URL. Re-ingesting isn't needed (citation URLs are built from `SITE_URL` at answer time).

### Step 2 — Fix A: one site (if you have a domain)

1. In Vercel, add `example.com` (and `www.`) as domains; in Render, add `api.example.com` as a custom
   domain. Follow each one's DNS instructions.
2. Set `NEXT_PUBLIC_API_URL=https://api.example.com` (Vercel) and `CORS_ORIGIN`, `SITE_URL`,
   `STAFF_APP_URL=https://example.com` (Render). Redeploy both.
3. Cookies can now be `SameSite=Lax` in production. Optional: leave them `None` — it still works on
   one site, and keeps working if you ever move the API elsewhere.

### Step 3 — Fix B: same-origin proxy (if you don't)

`apps/web/next.config.ts`:

```ts
const nextConfig: NextConfig = {
  serverExternalPackages: ["@repo/content"],
  async rewrites() {
    // The browser only ever talks to this origin; Next forwards /api/* to the API server-side, so the
    // API's cookies are first-party here. API_ORIGIN is server-only (no NEXT_PUBLIC_ prefix).
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_ORIGIN}/:path*`,
      },
    ];
  },
};
```

Vercel env: `API_ORIGIN=https://<your-api>.onrender.com`, `NEXT_PUBLIC_API_URL=/api`. In the site layout,
the widget's `data-api-url` becomes `/api` too (it's on the same origin).

API side — the refresh cookie's path must be what the **browser** sees (`/api/auth/refresh`), while
the route the API matches stays `/auth/refresh`:

```ts
// env.ts — the prefix a proxy puts in front of the API's routes ("" when the API is called directly).
export const PUBLIC_PATH_PREFIX = getEnv("PUBLIC_PATH_PREFIX", "");
```

```ts
// cookies.ts
export const REFRESH_PATH = "/auth/refresh"; // the route, as the API sees it
const REFRESH_COOKIE_PATH = `${PUBLIC_PATH_PREFIX}${REFRESH_PATH}`; // the path the browser requests

export const getRefreshTokenCookieOptions = (): CookieOptions => ({
  ...defaults,
  expires: thirtyDaysFromNow(),
  path: REFRESH_COOKIE_PATH,
});
// …and clearAuthCookies uses REFRESH_COOKIE_PATH for the refresh cookie too.
```

Render env: `PUBLIC_PATH_PREFIX=/api`. The error handler keeps comparing `req.path` with `REFRESH_PATH`.

Rate limits behind the proxy: change the chat limiter's IP bucket to a visitor bucket (or raise
`ipLimit` well above any real household), and note in `docs/security.md` that IP-based limits are
weaker in this deployment.

### Step 4 — Verify streaming and cookies in a cookie-blocking browser

In **Safari** (blocks third-party cookies by default) on the deployed site:

- Ask two questions in a row: the second must continue the same conversation (the transcript in staff
  shows both). If it doesn't, cookies aren't being stored.
- Log in to `/staff`: the leads page must load.
- Watch an answer: words must stream in. If the whole answer appears at once after a pause, the path in
  between buffers SSE — for option B, fall back to option A, or accept it and write it down.

### Step 5 — Local Compose: the web app

`Dockerfile`, a stage after `build`:

```dockerfile
# The site, built and served by Next. Used by the local Compose stack; production uses Vercel.
FROM base AS web
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm turbo run build --filter=web --ui=stream
WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]
```

`docker-compose.yml`:

```yaml
web:
  profiles: ["app"]
  build:
    context: .
    target: web
  ports:
    - "3000:3000"
  depends_on:
    api:
      condition: service_healthy
```

`NEXT_PUBLIC_API_URL` is baked in at build time (`ARG`), and it's the address the **browser** uses, so
`localhost:4000` (the API's published port), not `api:4000`.

### Step 6 — Polish pass

- **Error boundary for staff pages** — `app/staff/(protected)/error.tsx`:

```tsx
"use client";

export default function StaffError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 p-6"
    >
      <p className="font-semibold">Something went wrong on this page.</p>
      <p className="mt-1 text-sm text-stone-700">{error.message}</p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-lg bg-teal-800 px-3 py-1 text-white"
      >
        Try again
      </button>
    </div>
  );
}
```

- **Icon:** `app/icon.svg` (any simple SVG); Next serves it as the favicon automatically.
- **Metadata:** each content page already has a title from `generateMetadata`; add a `description` from
  the page's first paragraph if you like.
- **Contrast and focus:** check every text/background pair against WCAG AA (4.5:1 for body text) — the
  stone-600-on-white and teal-800 buttons should pass; anything lighter may not. Make sure every
  interactive element shows a visible focus ring (`focus-visible:outline` utilities).
- **Mobile:** site navigation wraps; staff tables scroll horizontally inside an `overflow-x-auto`
  wrapper instead of breaking the page.
- **Lighthouse** (Chrome dev tools → Lighthouse → Navigation, mobile): run on `/`, `/fees` and
  `/staff/leads`, fix what it reports, record the scores in `docs/deploy.md`.

## 7. Commit points

1. `feat(web): deploy configuration for vercel with turbo build`
2. `feat: serve the api through the site origin with a prefixed refresh cookie path` (option B) — or
   `docs: one-site domain setup` (option A)
3. `build: add the web app to the local compose stack`
4. `feat(web): staff error boundary, icon, accessibility and mobile fixes`

## 8. Verify

- The deployed site renders all pages; the widget answers; citations open highlighted sections.
- Safari: conversation continuity, staff login, streaming (Step 4).
- `docker compose --profile app up -d --build` → `http://localhost:3000` works end to end with the
  containerised API.
- Lighthouse accessibility ≥ 95 on `/`, `/fees`, `/staff/leads`; scores recorded.

## 9. Common mistakes

- **Vercel building only `apps/web`.** No widget, and possibly stale shared packages. Use the Turbo build
  command.
- **"Include files outside the root directory" off.** The workspace packages aren't in the build.
- **Changing `NEXT_PUBLIC_API_URL` without redeploying.** It's baked into the bundle at build time.
- **Option B without fixing the refresh cookie path.** Login works for 15 minutes, then every refresh
  fails and staff are logged out.
- **Option B without revisiting IP limits.** One busy visitor can exhaust the shared IP bucket for all.
- **Testing only in Chrome.** The cookie problem doesn't show up there by default.

## 10. Interview prep

**Q: Did you hit any cross-origin issues deploying?**
A: Yes: with the site and API on different public-suffix domains, the cookies are third-party and Safari
drops them, which breaks both staff login and conversation continuity. The proper fix is putting both
on one site (subdomains of one domain). The free alternative is a same-origin proxy, which needs the
refresh cookie path prefixed and weakens IP-based rate limits, since the API then sees the proxy's IP.

**Q: How do you deploy a monorepo app to Vercel?**
A: Root directory set to the app, files outside the root included, and a build command that runs Turbo
from the repo root so shared packages and the widget build first; unchanged deploys are skipped.

## 11. Resume-safe claim

"Deployed the Next.js frontend on Vercel from a Turborepo monorepo, solved third-party-cookie blocking
for cross-site auth, and reached Lighthouse accessibility [N] on key pages."

## 12. Definition of done

- [ ] Site live on Vercel; API env updated to the site's URL
- [ ] Safari checks pass (or the remaining limitation is documented)
- [ ] Compose `app` profile runs site + API + databases locally
- [ ] Lighthouse scores recorded, accessibility ≥ 95 on the three pages
