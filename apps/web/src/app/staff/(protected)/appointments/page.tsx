"use client";

import { useState } from "react";
import {
  useAppointments,
  useUpdateAppointment,
} from "@/hooks/staff/useAppointments";
import { useAttorneys } from "@/hooks/staff/useAttorneys";
import { QueryState } from "@/components/staff/QueryState";

const ZONE = "America/Phoenix";
const dayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  weekday: "long",
  month: "long",
  day: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  hour: "numeric",
  minute: "2-digit",
});

export default function AppointmentsPage() {
  const [attorneyId, setAttorneyId] = useState("");
  // Today onwards: the agenda is about what is coming up. A day's start is fine to the hour.
  const [from] = useState(() =>
    new Date(Date.now() - 86_400_000).toISOString(),
  );
  const attorneys = useAttorneys();
  const { data, isPending, error } = useAppointments({
    from,
    attorneyId: attorneyId || undefined,
  });
  const update = useUpdateAppointment();

  const byDay = new Map<string, NonNullable<typeof data>>();
  for (const appt of data ?? []) {
    const key = dayFormat.format(new Date(appt.startsAt));
    byDay.set(key, [...(byDay.get(key) ?? []), appt]);
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-normal tracking-tight">Appointments</h1>
        <label className="text-sm">
          <span className="mr-2 text-muted">Attorney</span>
          <select
            value={attorneyId}
            onChange={(e) => setAttorneyId(e.target.value)}
            className="rounded-lg border border-fog bg-canvas px-3 py-1.5"
          >
            <option value="">Everyone</option>
            {attorneys.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-1 text-sm text-muted">All times are Arizona time.</p>

      <div className="mt-6">
        <QueryState
          isPending={isPending}
          error={error}
          isEmpty={data?.length === 0}
          emptyText="No appointments yet."
        />
        {[...byDay.entries()].map(([day, appts]) => (
          <section key={day} className="mt-8" aria-label={day}>
            <h2 className="text-xl font-normal">{day}</h2>
            <ul className="mt-3 space-y-3">
              {appts.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-line bg-soft p-4"
                >
                  <div>
                    <p className="font-normal">
                      {timeFormat.format(new Date(a.startsAt))} · {a.name}
                    </p>
                    <p className="text-sm text-muted">
                      {a.attorneyName} · {a.caseType.replace(/_/g, " ")} ·{" "}
                      {a.mode === "video" ? "video" : "in person"}
                    </p>
                    <p className="text-sm text-muted">
                      {[a.phone, a.email].filter(Boolean).join(" · ")}
                    </p>
                    {a.summary ? (
                      <p className="mt-1 text-sm text-body">{a.summary}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-normal ${
                        a.status === "booked"
                          ? "bg-card text-ink"
                          : a.status === "cancelled"
                            ? "bg-red-50 text-red-800"
                            : "bg-green-50 text-green-900"
                      }`}
                    >
                      {a.status.replace("_", " ")}
                    </span>
                    {a.status === "booked" ? (
                      <select
                        aria-label={`Update ${a.name}'s appointment`}
                        defaultValue=""
                        disabled={update.isPending}
                        onChange={(e) => {
                          const status = e.target.value as
                            "completed" | "no_show" | "cancelled";
                          if (status) update.mutate({ id: a.id, status });
                        }}
                        className="rounded-lg border border-fog bg-canvas px-2 py-1 text-sm"
                      >
                        <option value="">Update…</option>
                        <option value="completed">Mark completed</option>
                        <option value="no_show">Mark no-show</option>
                        <option value="cancelled">Cancel</option>
                      </select>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
