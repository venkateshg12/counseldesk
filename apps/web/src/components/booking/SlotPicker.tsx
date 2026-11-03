"use client";

import type { Slot } from "@repo/types";
import { dayLabel, timeLabel } from "./format";

// Slots grouped by Arizona calendar day, as buttons.
export function SlotPicker({
  slots,
  disabled,
  onPick,
}: {
  slots: Slot[];
  disabled?: boolean;
  onPick: (slot: Slot) => void;
}) {
  if (slots.length === 0) {
    return (
      <p className="text-muted">
        No times are open in the next two weeks. Please call the office.
      </p>
    );
  }

  const days = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = dayLabel(slot.startsAt);
    days.set(key, [...(days.get(key) ?? []), slot]);
  }

  return (
    <div className="space-y-6">
      {[...days.entries()].map(([day, daySlots]) => (
        <section key={day} aria-label={day}>
          <h3 className="text-lg font-normal">{day}</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {daySlots.map((slot) => (
              <button
                key={slot.startsAt}
                type="button"
                disabled={disabled}
                onClick={() => onPick(slot)}
                className="rounded-lg border border-line bg-soft px-4 py-2 text-sm font-normal text-ink transition-colors hover:border-brand hover:text-link disabled:opacity-50"
              >
                {timeLabel(slot.startsAt)}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
