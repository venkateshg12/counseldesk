"use client";

import { useState } from "react";
import type { AvailabilityRuleInput, StaffAttorney } from "@repo/types";
import { useAttorneys, useSaveAvailability } from "@/hooks/staff/useAttorneys";
import { QueryState } from "@/components/staff/QueryState";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const toTime = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const fromTime = (value: string) => {
  const [h = "0", m = "0"] = value.split(":");
  return Number(h) * 60 + Number(m);
};

type Day = { on: boolean; start: string; end: string };

const toDays = (rules: AvailabilityRuleInput[]): Day[] =>
  DAYS.map((_, weekday) => {
    const rule = rules.find((r) => r.weekday === weekday);
    return rule
      ? {
          on: true,
          start: toTime(rule.startMinute),
          end: toTime(rule.endMinute),
        }
      : { on: false, start: "09:00", end: "17:00" };
  });

function HoursEditor({ attorney }: { attorney: StaffAttorney }) {
  const [days, setDays] = useState(() => toDays(attorney.availability));
  const save = useSaveAvailability();

  const set = (i: number, patch: Partial<Day>) =>
    setDays((current) =>
      current.map((d, n) => (n === i ? { ...d, ...patch } : d)),
    );

  const invalid = days.some(
    (d) => d.on && fromTime(d.end) <= fromTime(d.start),
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          attorneyId: attorney.id,
          rules: days.flatMap((d, weekday) =>
            d.on
              ? [
                  {
                    weekday,
                    startMinute: fromTime(d.start),
                    endMinute: fromTime(d.end),
                  },
                ]
              : [],
          ),
        });
      }}
      className="mt-4 space-y-2"
    >
      {days.map((d, i) => (
        <div
          key={DAYS[i]}
          className="flex flex-wrap items-center gap-3 text-sm"
        >
          <label className="flex w-36 items-center gap-2">
            <input
              type="checkbox"
              checked={d.on}
              onChange={(e) => set(i, { on: e.target.checked })}
            />
            {DAYS[i]}
          </label>
          <input
            type="time"
            aria-label={`${DAYS[i]} start`}
            value={d.start}
            disabled={!d.on}
            onChange={(e) => set(i, { start: e.target.value })}
            className="rounded-lg border border-fog bg-canvas px-2 py-1 disabled:opacity-40"
          />
          <span>to</span>
          <input
            type="time"
            aria-label={`${DAYS[i]} end`}
            value={d.end}
            disabled={!d.on}
            onChange={(e) => set(i, { end: e.target.value })}
            className="rounded-lg border border-fog bg-canvas px-2 py-1 disabled:opacity-40"
          />
        </div>
      ))}
      {invalid ? (
        <p role="alert" className="text-sm text-red-700">
          End time must be after the start time.
        </p>
      ) : null}
      {save.isError ? (
        <p role="alert" className="text-sm text-red-700">
          {(save.error as { message?: string }).message ?? "Couldn't save."}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={invalid || save.isPending}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-normal text-white hover:bg-brand-deep disabled:opacity-50"
      >
        {save.isPending ? "Saving…" : save.isSuccess ? "Saved" : "Save hours"}
      </button>
    </form>
  );
}

export default function AttorneysPage() {
  const { data, isPending, error } = useAttorneys();
  return (
    <>
      <h1 className="text-3xl font-normal tracking-tight">Attorneys</h1>
      <p className="mt-1 text-sm text-muted">
        Weekly hours decide which times visitors can book. All times are Arizona
        time.
      </p>
      <div className="mt-6">
        <QueryState
          isPending={isPending}
          error={error}
          isEmpty={data?.length === 0}
          emptyText="No attorneys yet. Run seed:attorneys."
        />
        <div className="space-y-6">
          {data?.map((a) => (
            <section
              key={a.id}
              className="rounded-lg border border-line bg-soft p-6"
              aria-label={a.name}
            >
              <h2 className="text-xl font-normal">{a.name}</h2>
              <p className="text-sm text-muted">
                {a.email} ·{" "}
                {a.practiceAreas.map((p) => p.replace(/_/g, " ")).join(", ")}
              </p>
              <HoursEditor attorney={a} />
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
