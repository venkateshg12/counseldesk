"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLeads } from "@/hooks/staff/useLeads";
import { Pager } from "@/components/staff/Pager";
import { QueryState } from "@/components/staff/QueryState";

const formatDate = (iso: string) => new Date(iso).toLocaleString();

function LeadsContent() {
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
            <div className="overflow-x-auto">
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
                          <p className="text-xs text-stone-600">
                            {lead.summary}
                          </p>
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
            </div>
            <Pager meta={data.meta} basePath="/staff/leads" />
          </>
        ) : null}
      </div>
    </>
  );
}

export default function LeadsPage() {
  return (
    <Suspense fallback={<p className="text-stone-600">Loading…</p>}>
      <LeadsContent />
    </Suspense>
  );
}
