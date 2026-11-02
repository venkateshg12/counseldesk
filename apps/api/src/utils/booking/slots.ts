import type { Slot } from "@repo/types";

/*
  Pure slot maths, with no database and no clock of its own, so it can be unit-tested.

  The firm works in Arizona time. Arizona does not observe daylight saving time, so its offset from
  UTC is a constant -7 hours all year and no time-zone database is needed. Times are stored and
  sent as UTC instants; only the weekly working hours are written in firm-local minutes.
 */
export const FIRM_TIME_ZONE = "America/Phoenix";
const FIRM_UTC_OFFSET_MINUTES = -7 * 60;

export const SLOT_MINUTES = 30;
export const BOOKING_WINDOW_DAYS = 14;
// A visitor can't book something starting in the next hour and a half: nobody could prepare.
export const MIN_LEAD_MS = 90 * 60 * 1000;

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export type WeeklyRule = {
  // 0 = Sunday ... 6 = Saturday, in firm-local time.
  weekday: number;
  startMinute: number;
  endMinute: number;
};

export const generateSlots = ({
  rules,
  now,
  unavailable = new Set<string>(),
  days = BOOKING_WINDOW_DAYS,
  slotMinutes = SLOT_MINUTES,
  minLeadMs = MIN_LEAD_MS,
}: {
  rules: WeeklyRule[];
  now: Date;
  // ISO start times already booked or on hold.
  unavailable?: Set<string>;
  days?: number;
  slotMinutes?: number;
  minLeadMs?: number;
}): Slot[] => {
  // Shift the clock so UTC arithmetic gives firm-local calendar days.
  const localNow = now.getTime() + FIRM_UTC_OFFSET_MINUTES * MINUTE_MS;
  const firstDayStart = Math.floor(localNow / DAY_MS) * DAY_MS;
  const earliest = now.getTime() + minLeadMs;

  const slots: Slot[] = [];
  for (let offset = 0; offset <= days; offset++) {
    const dayStart = firstDayStart + offset * DAY_MS;
    const weekday = new Date(dayStart).getUTCDay();

    for (const rule of rules) {
      if (rule.weekday !== weekday) continue;
      for (
        let minute = rule.startMinute;
        minute + slotMinutes <= rule.endMinute;
        minute += slotMinutes
      ) {
        const start =
          dayStart + minute * MINUTE_MS - FIRM_UTC_OFFSET_MINUTES * MINUTE_MS;
        if (start < earliest) continue;
        const startsAt = new Date(start).toISOString();
        if (unavailable.has(startsAt)) continue;
        slots.push({
          startsAt,
          endsAt: new Date(start + slotMinutes * MINUTE_MS).toISOString(),
        });
      }
    }
  }

  // Overlapping rules must not produce the same slot twice.
  const seen = new Set<string>();
  return slots
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .filter((slot) => !seen.has(slot.startsAt) && seen.add(slot.startsAt));
};

// The server never trusts a start time from the client: it must be exactly one of the real slots.
export const isBookableStart = (
  rules: WeeklyRule[],
  startsAt: string,
  now: Date,
  unavailable?: Set<string>,
) => {
  const normalized = new Date(startsAt).toISOString();
  return generateSlots({ rules, now, unavailable }).some(
    (slot) => slot.startsAt === normalized,
  );
};
