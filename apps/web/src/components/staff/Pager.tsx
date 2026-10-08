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
