# Phase 36 — Staff screens: leads, handoff queue, transcripts, metrics

## 1. Goal

The four staff screens the spec asks for ("a simple page listing captured leads … and the conversations
waiting for a human"), plus the transcript and metrics that make them useful:

| Route                       | Shows                                                              | API                                     |
| --------------------------- | ------------------------------------------------------------------ | --------------------------------------- |
| `/staff/leads`              | leads table, paginated, link to each conversation                  | `GET /staff/leads`                      |
| `/staff/handoffs`           | conversations waiting for a human, oldest first, with **Resolve**  | `GET /staff/handoffs`, `POST …/resolve` |
| `/staff/conversations/[id]` | full transcript with intents and clickable citations               | `GET /staff/conversations/:id`          |
| `/staff/metrics`            | last 7 days: answers' latency, intents, model calls, cost estimate | `GET /staff/stats`                      |

The spec says keep it basic: plain tables, no charts library, clear loading/empty/error states.

## 2. What I will understand after this phase

1. The e-commerce convention "one API function and one hook per operation", applied end to end.
2. How a mutation updates the screen: invalidating the right query keys after resolve.
3. Why pagination state lives in the URL.
4. How to show citations safely in staff UI (same rule as the widget).

## 3. Prerequisites

- Phase 35 done; some leads, a handoff and a few answered questions exist (use the widget).

## 4. Files

```
apps/web/src/
├── api/staff.ts                               NEW
├── hooks/staff/
│   ├── useLeads.ts, useHandoffs.ts, useTranscript.ts, useResolveHandoff.ts, useStats.ts   NEW
├── components/staff/Pager.tsx                 NEW  (the idea of e-commerce's AdminPager)
├── components/staff/QueryState.tsx            NEW  loading / error / empty
└── app/staff/(protected)/
    ├── leads/page.tsx                         NEW
    ├── handoffs/page.tsx                      NEW
    ├── conversations/[id]/page.tsx            NEW
    └── metrics/page.tsx                       NEW
```

## 5. Concepts

**One function, one hook per operation.** `api/staff.ts` holds plain functions that call the API;
`hooks/staff/useX.ts` wraps each in `useQuery` or `useMutation` with its key and cache rules. Pages only
call hooks. This is the e-commerce client's structure; it keeps HTTP details out of components and makes
each cache key defined in exactly one place.

**Invalidation after a mutation.** Resolving a handoff changes two lists (pending and resolved) and that
conversation's transcript. The mutation's `onSuccess` invalidates the `["handoffs"]` prefix and the
transcript key; React Query refetches whatever is on screen. No manual list surgery.

**Pagination in the URL.** `?page=3` in the address bar means the back button, a refresh and a shared
link all show the same page. `keepPreviousData` (TanStack's `placeholderData: keepPreviousData`) keeps
the old rows visible while the next page loads, so the table doesn't flash empty — the same choice as
e-commerce's admin tables.

**Citations in staff UI.** The transcript renders the stored citation snapshot (URL + heading). Links are
plain anchors to the stored URL, opened in a new tab; text is rendered by React, which escapes it. Staff
see exactly what the visitor saw.

## 6. Steps

### Step 1 — `api/staff.ts`

```ts
import API from "@/lib/api";

type Envelope<T, M = undefined> = { status: "success"; data: T; meta: M };
export type PageMeta = {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

export type LeadRow = {
  id: string;
  conversationId: string;
  name: string;
  email: string | null;
  phone: string | null;
  caseType: string;
  summary: string | null;
  notifiedAt: string | null;
  createdAt: string;
};

export type HandoffRow = {
  id: string;
  conversationId: string;
  reason: string;
  status: "pending" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
  leadName: string | null;
  lastMessage: string | null;
};

export type Transcript = {
  conversation: { id: string; status: string; createdAt: string };
  lead: LeadRow | null;
  handoff: { id: string; status: string; reason: string } | null;
  messages: {
    id: string;
    role: "user" | "assistant";
    content: string;
    intent: string | null;
    createdAt: string;
    citations: { number: number; url: string; heading: string }[];
  }[];
};

export const getLeads = async (page: number) =>
  (
    await API.get<Envelope<LeadRow[], PageMeta>>("/staff/leads", {
      params: { page, limit: 25 },
    })
  ).data;

export const getHandoffs = async (
  status: "pending" | "resolved",
  page: number,
) =>
  (
    await API.get<Envelope<HandoffRow[], PageMeta>>("/staff/handoffs", {
      params: { status, page, limit: 25 },
    })
  ).data;

export const getTranscript = async (id: string) =>
  (await API.get<Envelope<Transcript>>(`/staff/conversations/${id}`)).data.data;

export const resolveHandoff = async (id: string) =>
  API.post(`/staff/handoffs/${id}/resolve`);

export const getStats = async (days: number) =>
  (await API.get<Envelope<StaffStats>>("/staff/stats", { params: { days } }))
    .data.data;

export type StaffStats = {
  days: number;
  pricesAsOf: string;
  totals: Record<string, number>;
  answers: {
    count: number;
    firstTokenP50: number | null;
    firstTokenP95: number | null;
    totalP50: number | null;
    totalP95: number | null;
    avgRouteMs: number | null;
    avgRetrieveMs: number | null;
  };
  intents: { intent: string | null; messages: number }[];
  calls: {
    purpose: string;
    provider: string;
    calls: number;
    errorRate: number;
    fallbackRate: number;
    p50Ms: number | null;
    p95Ms: number | null;
    avgInputTokens: number | null;
    avgOutputTokens: number | null;
    estimatedCostUsd: number;
  }[];
};
```

These response types restate the API's shapes. Moving them into `@repo/types` would remove the
duplication; it's a reasonable follow-up, kept out here to keep the phase small.

### Step 2 — Hooks

`hooks/staff/useLeads.ts`:

```ts
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getLeads } from "@/api/staff";

export const useLeads = (page: number) =>
  useQuery({
    queryKey: ["leads", page],
    queryFn: () => getLeads(page),
    placeholderData: keepPreviousData,
  });
```

`hooks/staff/useHandoffs.ts`:

```ts
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getHandoffs } from "@/api/staff";

export const useHandoffs = (status: "pending" | "resolved", page: number) =>
  useQuery({
    queryKey: ["handoffs", status, page],
    queryFn: () => getHandoffs(status, page),
    placeholderData: keepPreviousData,
  });
```

`hooks/staff/useTranscript.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { getTranscript } from "@/api/staff";

export const transcriptKey = (id: string) => ["transcript", id] as const;

export const useTranscript = (id: string) =>
  useQuery({ queryKey: transcriptKey(id), queryFn: () => getTranscript(id) });
```

`hooks/staff/useResolveHandoff.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { resolveHandoff } from "@/api/staff";
import { transcriptKey } from "./useTranscript";

export const useResolveHandoff = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      handoffId,
    }: {
      handoffId: string;
      conversationId: string;
    }) => resolveHandoff(handoffId),
    // Also on error: a 409 means someone else resolved it, so the list is stale either way.
    onSettled: (_data, _error, { conversationId }) => {
      void queryClient.invalidateQueries({ queryKey: ["handoffs"] });
      void queryClient.invalidateQueries({
        queryKey: transcriptKey(conversationId),
      });
    },
  });
};
```

`hooks/staff/useStats.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { getStats } from "@/api/staff";

export const useStats = (days: number) =>
  useQuery({ queryKey: ["stats", days], queryFn: () => getStats(days) });
```

### Step 3 — Shared components

`components/staff/QueryState.tsx`:

```tsx
export function QueryState({
  isPending,
  error,
  isEmpty,
  emptyText,
}: {
  isPending: boolean;
  error: unknown;
  isEmpty: boolean;
  emptyText: string;
}) {
  if (isPending) return <p className="text-stone-600">Loading…</p>;
  if (error)
    return (
      <p role="alert" className="text-red-700">
        {(error as { message?: string }).message ?? "Couldn't load this."}
      </p>
    );
  if (isEmpty) return <p className="text-stone-600">{emptyText}</p>;
  return null;
}
```

`components/staff/Pager.tsx`:

```tsx
"use client";

import Link from "next/link";
import type { PageMeta } from "@/api/staff";

export function Pager({
  meta,
  basePath,
}: {
  meta: PageMeta;
  basePath: string;
}) {
  const lastPage = Math.max(1, Math.ceil(meta.total / meta.limit));
  const href = (page: number) =>
    `${basePath}${basePath.includes("?") ? "&" : "?"}page=${page}`;
  return (
    <nav
      aria-label="Pages"
      className="mt-4 flex items-center justify-between text-sm"
    >
      <span className="text-stone-600">
        Page {meta.page} of {lastPage} · {meta.total} total
      </span>
      <span className="flex gap-3">
        {meta.page > 1 ? (
          <Link href={href(meta.page - 1)} className="underline">
            Previous
          </Link>
        ) : null}
        {meta.hasMore ? (
          <Link href={href(meta.page + 1)} className="underline">
            Next
          </Link>
        ) : null}
      </span>
    </nav>
  );
}
```

### Step 4 — Pages

`leads/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLeads } from "@/hooks/staff/useLeads";
import { Pager } from "@/components/staff/Pager";
import { QueryState } from "@/components/staff/QueryState";

const formatDate = (iso: string) => new Date(iso).toLocaleString();

export default function LeadsPage() {
  const page = Math.max(1, Number(useSearchParams().get("page")) || 1);
  const { data, isPending, error } = useLeads(page);

  return (
    <>
      <h1 className="text-2xl font-bold">Leads</h1>
      <div className="mt-6">
        <QueryState
          isPending={isPending}
          error={error}
          isEmpty={data?.data.length === 0}
          emptyText="No leads yet."
        />
        {data?.data.length ? (
          <>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-stone-300 text-stone-600">
                <tr>
                  <th className="py-2">Received</th>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Case</th>
                  <th>Email sent</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.data.map((lead) => (
                  <tr
                    key={lead.id}
                    className="border-b border-stone-200 align-top"
                  >
                    <td className="py-2 whitespace-nowrap">
                      {formatDate(lead.createdAt)}
                    </td>
                    <td>
                      {lead.name}
                      {lead.summary ? (
                        <p className="text-xs text-stone-600">{lead.summary}</p>
                      ) : null}
                    </td>
                    <td>
                      {[lead.phone, lead.email].filter(Boolean).join(" · ")}
                    </td>
                    <td>{lead.caseType.replace(/_/g, " ")}</td>
                    <td>{lead.notifiedAt ? "Yes" : "Pending"}</td>
                    <td>
                      <Link
                        href={`/staff/conversations/${lead.conversationId}`}
                        className="underline"
                      >
                        Conversation
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager meta={data.meta} basePath="/staff/leads" />
          </>
        ) : null}
      </div>
    </>
  );
}
```

`handoffs/page.tsx` — the same structure with a status switch and a Resolve button:

```tsx
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useHandoffs } from "@/hooks/staff/useHandoffs";
import { useResolveHandoff } from "@/hooks/staff/useResolveHandoff";
import { Pager } from "@/components/staff/Pager";
import { QueryState } from "@/components/staff/QueryState";

export default function HandoffsPage() {
  const params = useSearchParams();
  const status = params.get("status") === "resolved" ? "resolved" : "pending";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const { data, isPending, error } = useHandoffs(status, page);
  const resolve = useResolveHandoff();

  return (
    <>
      <h1 className="text-2xl font-bold">Conversations needing a human</h1>
      <div className="mt-4 flex gap-4 text-sm">
        <Link
          href="/staff/handoffs"
          aria-current={status === "pending" ? "page" : undefined}
          className="aria-[current=page]:font-semibold"
        >
          Pending
        </Link>
        <Link
          href="/staff/handoffs?status=resolved"
          aria-current={status === "resolved" ? "page" : undefined}
          className="aria-[current=page]:font-semibold"
        >
          Resolved
        </Link>
      </div>
      <div className="mt-6 space-y-3">
        <QueryState
          isPending={isPending}
          error={error}
          isEmpty={data?.data.length === 0}
          emptyText={
            status === "pending"
              ? "Nothing waiting. 🎉"
              : "Nothing resolved yet."
          }
        />
        {data?.data.map((handoff) => (
          <article
            key={handoff.id}
            className="rounded-xl border border-stone-200 bg-white p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold">
                  {handoff.leadName ?? "No contact details given"}
                </p>
                <p className="text-sm text-stone-600">
                  {handoff.reason} ·{" "}
                  {new Date(handoff.createdAt).toLocaleString()}
                </p>
                {handoff.lastMessage ? (
                  <p className="mt-2 text-sm">“{handoff.lastMessage}”</p>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-3 text-sm">
                <Link
                  href={`/staff/conversations/${handoff.conversationId}`}
                  className="underline"
                >
                  Open
                </Link>
                {handoff.status === "pending" ? (
                  <button
                    type="button"
                    disabled={resolve.isPending}
                    onClick={() =>
                      resolve.mutate({
                        handoffId: handoff.id,
                        conversationId: handoff.conversationId,
                      })
                    }
                    className="rounded-lg bg-teal-800 px-3 py-1 text-white disabled:opacity-50"
                  >
                    Resolve
                  </button>
                ) : null}
              </div>
            </div>
          </article>
        ))}
        {data ? (
          <Pager
            meta={data.meta}
            basePath={
              status === "resolved"
                ? "/staff/handoffs?status=resolved"
                : "/staff/handoffs"
            }
          />
        ) : null}
      </div>
    </>
  );
}
```

`conversations/[id]/page.tsx`:

```tsx
"use client";

import { useParams } from "next/navigation";
import { useTranscript } from "@/hooks/staff/useTranscript";
import { QueryState } from "@/components/staff/QueryState";

export default function TranscriptPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isPending, error } = useTranscript(id);

  return (
    <>
      <h1 className="text-2xl font-bold">Conversation</h1>
      <QueryState
        isPending={isPending}
        error={error}
        isEmpty={false}
        emptyText=""
      />
      {data ? (
        <>
          <p className="mt-2 text-sm text-stone-600">
            Status: {data.conversation.status.replace(/_/g, " ")} · started{" "}
            {new Date(data.conversation.createdAt).toLocaleString()}
            {data.lead
              ? ` · lead: ${data.lead.name}, ${[data.lead.phone, data.lead.email].filter(Boolean).join(" · ")}`
              : ""}
          </p>
          <ol className="mt-6 space-y-4">
            {data.messages.map((message) => (
              <li
                key={message.id}
                className={message.role === "user" ? "text-right" : ""}
              >
                <div
                  className={`inline-block max-w-[80%] rounded-xl px-4 py-3 text-left text-sm whitespace-pre-wrap ${message.role === "user" ? "bg-teal-800 text-white" : "bg-white border border-stone-200"}`}
                >
                  {message.content}
                  {message.citations.length ? (
                    <ul className="mt-2 border-t border-stone-200 pt-2 text-xs">
                      {message.citations.map((c) => (
                        <li key={c.number}>
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noopener"
                            className="underline"
                          >
                            [{c.number}] {c.heading}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-stone-500">
                  {message.role === "assistant" && message.intent
                    ? `${message.intent.replace(/_/g, " ")} · `
                    : ""}
                  {new Date(message.createdAt).toLocaleTimeString()}
                </p>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </>
  );
}
```

`metrics/page.tsx`:

```tsx
"use client";

import { useStats } from "@/hooks/staff/useStats";
import { QueryState } from "@/components/staff/QueryState";

const ms = (value: number | null) => (value === null ? "—" : `${value} ms`);
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

export default function MetricsPage() {
  const { data, isPending, error } = useStats(7);

  return (
    <>
      <h1 className="text-2xl font-bold">Last 7 days</h1>
      <QueryState
        isPending={isPending}
        error={error}
        isEmpty={false}
        emptyText=""
      />
      {data ? (
        <div className="mt-6 space-y-8 text-sm">
          <section>
            <h2 className="text-lg font-semibold">Answers</h2>
            <p className="mt-2">
              {data.answers.count} answers · first token p50{" "}
              {ms(data.answers.firstTokenP50)}, p95{" "}
              {ms(data.answers.firstTokenP95)} · total p50{" "}
              {ms(data.answers.totalP50)}, p95 {ms(data.answers.totalP95)} ·
              routing avg {ms(data.answers.avgRouteMs)} · retrieval avg{" "}
              {ms(data.answers.avgRetrieveMs)}
            </p>
            <p className="mt-1 text-stone-600">
              {data.totals.conversations} conversations · {data.totals.leads}{" "}
              leads · {data.totals.pending_handoffs} waiting for a human
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold">Messages by intent</h2>
            <ul className="mt-2">
              {data.intents.map((row) => (
                <li key={row.intent ?? "none"}>
                  {(row.intent ?? "none").replace(/_/g, " ")}: {row.messages}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="text-lg font-semibold">Model calls</h2>
            <p className="text-stone-600">
              Cost estimated at paid-tier list prices as of {data.pricesAsOf};
              actual cost on free tiers is $0.
            </p>
            <table className="mt-2 w-full text-left">
              <thead className="border-b border-stone-300 text-stone-600">
                <tr>
                  <th className="py-2">Purpose</th>
                  <th>Provider</th>
                  <th>Calls</th>
                  <th>Errors</th>
                  <th>Fallbacks</th>
                  <th>p50</th>
                  <th>p95</th>
                  <th>Tokens in/out</th>
                  <th>Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {data.calls.map((row) => (
                  <tr
                    key={`${row.purpose}-${row.provider}`}
                    className="border-b border-stone-200"
                  >
                    <td className="py-2">{row.purpose}</td>
                    <td>{row.provider}</td>
                    <td>{row.calls}</td>
                    <td>{pct(row.errorRate)}</td>
                    <td>{pct(row.fallbackRate)}</td>
                    <td>{ms(row.p50Ms)}</td>
                    <td>{ms(row.p95Ms)}</td>
                    <td>
                      {row.avgInputTokens ?? "—"} / {row.avgOutputTokens ?? "—"}
                    </td>
                    <td>${row.estimatedCostUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      ) : null}
    </>
  );
}
```

As with the login page, `useSearchParams` in these pages may need a `<Suspense>` boundary for `next
build`; if the build asks for it, wrap the page body in a small inner component inside `<Suspense>`.

## 7. Commit points

1. `feat(web): add staff api functions and query hooks`
2. `feat(web): add leads table and handoff queue with resolve`
3. `feat(web): add conversation transcript and metrics pages`

## 8. Verify

- Leads appear newest first; "Conversation" opens the transcript with intents and citation links.
- Pagination: with more than 25 leads (or `limit` lowered temporarily), Next/Previous work, the URL has
  `?page=`, and the back button returns to the previous page.
- Resolve a handoff: it disappears from Pending, appears under Resolved; the transcript status becomes
  "closed". Resolve the same handoff from a second browser tab → the list just refreshes (409 handled).
- Metrics shows real numbers matching `pnpm --filter api report --days 7`.
- Empty states: a fresh database shows "No leads yet." and "Nothing waiting."

## 9. Common mistakes

- **API calls inside components.** Keep them in `api/` and hooks; pages stay readable.
- **Forgetting to invalidate after a mutation**, then "fixing" it with `window.location.reload()`.
- **Pagination in component state.** Lost on refresh and back.
- **Rendering message content with `dangerouslySetInnerHTML`** to keep line breaks. `whitespace-pre-wrap`
  does that safely.

## 10. Interview prep

**Q: How is your frontend data layer organised?**
A: One API function and one React Query hook per operation; pages only use hooks. Lists keep previous
data while paginating; mutations invalidate the affected query prefixes on settle, so concurrent edits
from another staff member are reflected too.

## 11. Resume-safe claim

"Built the staff dashboard (leads, human-handoff queue with resolution, transcripts with citations,
latency/cost metrics) with React Query and URL-driven pagination."

## 12. Definition of done

- [ ] All four screens work against the local API, with loading, empty and error states
- [ ] Resolve updates both lists and the transcript
- [ ] Pagination survives refresh and back
- [ ] Build, typecheck and lint pass
