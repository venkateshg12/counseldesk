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
            <div className="overflow-x-auto">
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
                        {row.avgInputTokens ?? "—"} /{" "}
                        {row.avgOutputTokens ?? "—"}
                      </td>
                      <td>${row.estimatedCostUsd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
