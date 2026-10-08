"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useHandoffs } from "@/hooks/staff/useHandoffs";
import { useResolveHandoff } from "@/hooks/staff/useResolveHandoff";
import { Pager } from "@/components/staff/Pager";
import { QueryState } from "@/components/staff/QueryState";

function HandoffsContent() {
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

export default function HandoffsPage() {
  return (
    <Suspense fallback={<p className="text-stone-600">Loading…</p>}>
      <HandoffsContent />
    </Suspense>
  );
}
