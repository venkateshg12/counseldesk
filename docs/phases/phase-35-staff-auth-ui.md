# Phase 35 — Staff app: API client with silent refresh, login, protected routes

## 1. Goal

The staff side of `apps/web`: a login page, and an authenticated area under `/staff` that only renders
once `/auth/me` confirms a session. Under the hood, the e-commerce client's Axios instance — with its
silent-refresh interceptor that queues concurrent 401s while one `/auth/refresh` runs — and its
TanStack Query and Zustand conventions.

Also a restructure: the site's header, footer and widget move into a `(site)` route group, so the staff
pages don't load the visitor widget or the marketing chrome.

## 2. What I will understand after this phase

1. How silent refresh works, and why concurrent 401s must wait for a single refresh.
2. Why route protection here is a client-side gate and why that's still secure.
3. How route groups give two different layouts without changing URLs.
4. The cross-site cookie problem in production and its options.

## 3. Prerequisites

- Phase 34 done; a staff account seeded (Phase 06).

## 4. Files

```
apps/web/src/
├── app/
│   ├── layout.tsx                         (html/body only)
│   ├── (site)/layout.tsx                  NEW  header, footer, widget
│   ├── (site)/page.tsx                    (moved from app/page.tsx)
│   ├── (site)/[...slug]/page.tsx          (moved)
│   ├── staff/layout.tsx                   NEW  client providers
│   ├── staff/login/page.tsx               NEW
│   └── staff/(protected)/layout.tsx       NEW  auth gate + staff nav
│       └── page.tsx                       NEW  redirects to /staff/leads
├── lib/api.ts                             ADAPT e-commerce/apps/client/src/lib/api.ts
├── lib/serverStatus.ts                    COPY  e-commerce/apps/client/src/lib/serverStatus.ts
├── lib/queryClient.ts                     ADAPT e-commerce/apps/client/src/lib/queryClient.ts
├── store/server.store.ts                  COPY  e-commerce/apps/client/src/store/server.store.ts
├── store/auth.store.ts                    ADAPT e-commerce/apps/client/src/store/auth.store.ts
├── components/staff/Providers.tsx         NEW
├── components/staff/ServerWakeNotice.tsx  ADAPT e-commerce/apps/client/src/components/common/ServerWakeNotice.tsx
├── api/auth.ts                            NEW  one function per call (e-commerce convention)
└── hooks/auth/{useMe,useLogin,useLogout}.ts NEW
```

## 5. Concepts

**Silent refresh.** The access token lives 15 minutes. When it expires, the next API call gets `401
TOKEN_EXPIRED`. The interceptor catches it, calls `/auth/refresh` (which rotates both cookies), and
replays the original request — the staff member never notices. If five requests fail at once, only the
first triggers a refresh; the other four wait in a queue and are replayed when it finishes. Five
parallel refreshes would each present the same refresh token, and after the first, the rest would look
like reuse (Phase 07) — signing the user out. The queue is what makes rotation and parallel requests
compatible. This is the e-commerce interceptor, kept as is.

**Client-side gate, server-side security.** The staff pages are Client Components that ask `/auth/me`
before rendering and redirect to login on 401. Someone can bypass that in their browser and see an
empty table layout — but every byte of data comes from `/staff/*` endpoints that check the session on
the server (Phase 07). The gate is UX; the API is the security. (Next's middleware can't help here: the
auth cookies belong to the API's domain, so the Next server never sees them.)

**Route groups.** A folder in parentheses — `(site)`, `(protected)` — groups routes under a layout
without appearing in the URL. `/fees` uses the `(site)` layout with header, footer and widget;
`/staff/leads` uses the staff layouts with providers and the auth gate.

**Cross-site cookies in production.** With the site on `vercel.app` and the API on `onrender.com`, the
auth and visitor cookies are **third-party** cookies from the browser's point of view. They're set with
`SameSite=None; Secure` (correct), but browsers that block third-party cookies by default — Safari, and
any browser with strict privacy settings — won't store them: staff login fails and every chat message
looks like a new visitor. The e-commerce app has the same architecture. Two real fixes: put both on one
domain you own (`app.example.com` and `api.example.com` are the same _site_), or proxy the API through
the Next app so the browser only ever talks to one origin. Phase 37 implements the proxy with Next
rewrites and tests it in Safari.

## 6. Steps

### Step 1 — Install

```bash
pnpm --filter web add axios@^1.20.0 @tanstack/react-query@^5.104.1 zustand@^5.0.15
```

Same libraries and majors as the e-commerce client.

### Step 2 — Route groups

Move the site into `(site)`:

```bash
cd apps/web/src/app
mkdir -p "(site)" && git mv page.tsx "(site)/page.tsx" && git mv "[...slug]" "(site)/[...slug]"
```

`app/layout.tsx` keeps only `<html>`/`<body>` and global CSS (remove the widget `<Script>`).

`app/(site)/layout.tsx`:

```tsx
import Script from "next/script";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
      <Script
        src="/widget/counseldesk.js"
        data-api-url={process.env.NEXT_PUBLIC_API_URL}
        strategy="afterInteractive"
      />
    </>
  );
}
```

and simplify `SitePage` to render just `<MarkdownPage page={page} />` (the layout provides the chrome).

### Step 3 — Client infrastructure

`lib/serverStatus.ts` and `store/server.store.ts`: COPY from e-commerce unchanged (the cold-start
detection you built for ShopyMart — staff hit the same sleeping API).

`store/auth.store.ts` — ADAPT, cut down to what staff need:

```ts
import { create } from "zustand";

export type StaffUser = { id: string; email: string; name: string };

type AuthStore = {
  user: StaffUser | null;
  setUser: (user: StaffUser) => void;
  clearAuth: () => void;
};

export const useAuthStore = create<AuthStore>()((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  clearAuth: () => set({ user: null }),
}));
```

`lib/queryClient.ts` — ADAPT: keep the wake-aware `retry` / `retryDelay` and the refetch-after-wake
subscription verbatim; replace the e-commerce `USER_SCOPED_KEYS` with `queryClient.clear()` on logout
(the staff app has no data that should survive a session).

`lib/api.ts` — COPY e-commerce's file, change only:

- `import { API_URL } from "@/constants/env"` → `const API_URL = process.env.NEXT_PUBLIC_API_URL!;`
- `AUTH_ROUTES` → `["/auth/login", "/auth/refresh"]` (the only auth routes this API has)
- on refresh failure, `clearUserQueries()` → `queryClient.clear()`
- the `ApiError` / `RetryableRequestConfig` / `QueueItem` types: copy their definitions from
  e-commerce's `src/types` into `src/types/api.ts`

Everything else — the wake timer, the refresh queue, the error normalisation to `{ status, message,
code, errors }` — stays exactly as you wrote it.

`components/staff/ServerWakeNotice.tsx` — ADAPT e-commerce's component, replacing its CSS classes with
Tailwind:

```tsx
"use client";

import { useEffect } from "react";
import { useServerStore } from "@/store/server.store";

const READY_VISIBLE_MS = 2000;

export function ServerWakeNotice() {
  const status = useServerStore((state) => state.status);
  const reset = useServerStore((state) => state.reset);

  useEffect(() => {
    if (status !== "ready") return;
    const timer = setTimeout(reset, READY_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [status, reset]);

  if (status === "idle") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-stone-200 bg-white p-4 text-sm shadow-lg"
    >
      <p className="font-semibold">
        {status === "waking" ? "Waking up the server" : "Server is ready"}
      </p>
      <p className="mt-1 text-stone-600">
        {status === "waking"
          ? "The API runs on a free tier that sleeps when idle; the first request can take up to a minute."
          : "Loading your data now."}
      </p>
    </div>
  );
}
```

`components/staff/Providers.tsx`:

```tsx
"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import queryClient from "@/lib/queryClient";
import { ServerWakeNotice } from "./ServerWakeNotice";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ServerWakeNotice />
    </QueryClientProvider>
  );
}
```

`app/staff/layout.tsx` (a Server Component that renders the client providers):

```tsx
import type { Metadata } from "next";
import { Providers } from "@/components/staff/Providers";

export const metadata: Metadata = { title: "Staff", robots: { index: false } };

export default function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Providers>{children}</Providers>;
}
```

`robots: { index: false }` keeps search engines from listing the staff login.

### Step 4 — API functions and hooks

`api/auth.ts`:

```ts
import API from "@/lib/api";
import type { StaffLogin } from "@repo/types";
import type { StaffUser } from "@/store/auth.store";

type Envelope<T> = { status: "success"; data: T };

export const login = async (body: StaffLogin) =>
  (await API.post<Envelope<{ user: StaffUser }>>("/auth/login", body)).data.data
    .user;
export const logout = async () => API.post("/auth/logout");
export const getMe = async () =>
  (await API.get<Envelope<{ user: StaffUser }>>("/auth/me")).data.data.user;
```

`hooks/auth/useMe.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { getMe } from "@/api/auth";

export const ME_KEY = ["me"] as const;

// The session check. A 401 is an answer ("not signed in"), not a failure to retry.
export const useMe = () =>
  useQuery({
    queryKey: ME_KEY,
    queryFn: getMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
```

`hooks/auth/useLogin.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { login } from "@/api/auth";
import { useAuthStore } from "@/store/auth.store";
import { ME_KEY } from "./useMe";

export const useLogin = () => {
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  return useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      setUser(user);
      queryClient.setQueryData(ME_KEY, user); // the gate doesn't need a second round trip
    },
  });
};
```

`hooks/auth/useLogout.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { logout } from "@/api/auth";
import { useAuthStore } from "@/store/auth.store";

export const useLogout = () => {
  const queryClient = useQueryClient();
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const router = useRouter();
  return useMutation({
    mutationFn: logout,
    onSettled: () => {
      clearAuth();
      queryClient.clear();
      router.replace("/staff/login");
    },
  });
};
```

`onSettled`, not `onSuccess`: even if the logout request fails (server asleep), the local session state
is cleared.

### Step 5 — Login page

`app/staff/login/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { staffLoginSchema } from "@repo/types";
import { useLogin } from "@/hooks/auth/useLogin";

export default function LoginPage() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const loginMutation = useLogin();
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = staffLoginSchema.safeParse({
      email: form.get("email"),
      password: form.get("password"),
    });
    if (!parsed.success) {
      setFormError(
        parsed.error.issues[0]?.message ?? "Check your email and password.",
      );
      return;
    }
    setFormError(null);
    loginMutation.mutate(parsed.data, {
      // Only same-site relative paths are honoured, so ?next= can't send someone to another site.
      onSuccess: () =>
        router.replace(next?.startsWith("/staff") ? next : "/staff/leads"),
    });
  };

  const error =
    formError ?? (loginMutation.error as { message?: string } | null)?.message;

  return (
    <main className="mx-auto mt-24 max-w-sm px-6">
      <h1 className="text-2xl font-bold">Staff sign in</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={loginMutation.isPending}
          className="w-full rounded-lg bg-teal-800 py-2 font-medium text-white disabled:opacity-50"
        >
          {loginMutation.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
```

- The same `staffLoginSchema` the API validates with: the form and the server can't disagree.
- `useSearchParams` in a Client Component page requires a Suspense boundary during static rendering;
  if `next build` complains, wrap the form in `<Suspense>` in a small parent component (Next's error
  message names this exactly).
- The `?next=` check prevents an open redirect (`/staff/login?next=https://evil.example`).

### Step 6 — The gate

`app/staff/(protected)/layout.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMe } from "@/hooks/auth/useMe";
import { useLogout } from "@/hooks/auth/useLogout";

const NAV = [
  { href: "/staff/leads", label: "Leads" },
  { href: "/staff/handoffs", label: "Needs a human" },
  { href: "/staff/metrics", label: "Metrics" },
];

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const logoutMutation = useLogout();

  useEffect(() => {
    if (me.isError)
      router.replace(`/staff/login?next=${encodeURIComponent(pathname)}`);
  }, [me.isError, router, pathname]);

  if (!me.data) {
    return (
      <p className="p-8 text-stone-600">
        {me.isError ? "Redirecting to sign in…" : "Checking your session…"}
      </p>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <nav
          className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3"
          aria-label="Staff"
        >
          <span className="font-bold text-teal-900">CounselDesk · Staff</span>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname.startsWith(item.href) ? "page" : undefined}
              className="text-sm text-stone-700 aria-[current=page]:font-semibold"
            >
              {item.label}
            </Link>
          ))}
          <span className="ml-auto text-sm text-stone-600">{me.data.name}</span>
          <button
            type="button"
            onClick={() => logoutMutation.mutate()}
            className="text-sm underline"
          >
            Sign out
          </button>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
```

`app/staff/(protected)/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function StaffHome() {
  redirect("/staff/leads");
}
```

(The leads page itself comes in Phase 36; until then `/staff/leads` is a 404 behind a working gate —
or add a one-line placeholder page.)

## 7. Commit points

1. `refactor(web): move the public site into a route group with its own layout`
2. `feat(web): add axios client with silent refresh and wake detection from e-commerce`
3. `feat(web): add staff login, session gate and sign out`

## 8. Verify

With the API on `pnpm dev` (development cookies: `SameSite=Lax`, not `Secure`, so `http://localhost`
works):

- `/staff/leads` while signed out → redirected to `/staff/login?next=%2Fstaff%2Fleads`.
- Wrong password → the API's message under the form. Correct → lands on `/staff/leads`.
- The staff pages don't show the chat bubble; `/fees` does.
- Silent refresh: in the browser's dev tools, delete only the `accessToken` cookie, then navigate within
  staff → the Network tab shows `401`, `GET /auth/refresh` `200`, and the original request replayed
  `200`. Delete both cookies → back to the login page.
- Parallel refresh: with the access cookie deleted, a page that fires three queries at once (Phase 36's
  metrics page) shows exactly **one** `/auth/refresh`.
- `/staff/login?next=https://example.com` → after login you land on `/staff/leads`, not example.com.

## 9. Common mistakes

- **Treating the client gate as security.** The API must (and does) check every request.
- **Retrying `/auth/me` on 401.** It's an answer, not a failure; `retry: false`.
- **Calling `/auth/refresh` from every failed request.** Without the queue, parallel refreshes trip reuse
  detection and sign the user out.
- **Honouring any `?next=` URL.** That's an open redirect.
- **Testing staff login against the Docker Compose API.** It runs with `NODE_ENV=production`, so its
  cookies are `Secure` and won't be set over `http://localhost` (Phase 27's note).

## 10. Interview prep

**Q: How does your frontend handle expired tokens?**
A: An Axios response interceptor catches 401s, runs one `/auth/refresh` while queueing any other failing
requests, then replays them all; if the refresh fails, it clears local auth and the user is sent to
login. The queue matters because the API rotates refresh tokens with reuse detection — parallel refreshes
would look like theft.

**Q: How are the staff routes protected?**
A: The real protection is the API: every `/staff` endpoint checks the session server-side. The Next app's
gate just asks `/auth/me` and redirects for a better experience.

**Q: Any problem with cookies across your two hosts?**
A: Yes — on different sites they're third-party cookies, which Safari blocks. The fix is to serve the API
under the same site, which I did with a same-origin proxy (Phase 37).

## 11. Resume-safe claim

"Built the staff frontend's auth flow — silent token refresh with a single-flight request queue,
session-gated routes, and cold-start awareness — reusing patterns from an earlier production project."

## 12. Definition of done

- [ ] Login, gate, sign-out work; staff pages have no widget
- [ ] Silent refresh observed with a single `/auth/refresh` for parallel 401s
- [ ] Open-redirect check passes
- [ ] Build, typecheck and lint pass
