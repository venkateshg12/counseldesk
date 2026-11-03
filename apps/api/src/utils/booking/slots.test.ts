import { describe, expect, it } from "vitest";
import {
  generateSlots,
  isBookableStart,
  MIN_LEAD_MS,
  type WeeklyRule,
} from "./slots.js";

// Monday-to-Friday, 9:00-11:00 firm time (Arizona is UTC-7 all year, so 16:00-18:00 UTC).
const weekdays: WeeklyRule[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startMinute: 9 * 60,
  endMinute: 11 * 60,
}));

// Monday 2026-10-19 06:00 UTC = Sunday 2026-10-18 23:00 in Arizona.
const sundayNightArizona = new Date("2026-10-19T06:00:00Z");

describe("generateSlots", () => {
  it("produces 30-minute slots inside the working hours, in firm time", () => {
    const slots = generateSlots({
      rules: weekdays,
      now: sundayNightArizona,
      days: 1,
    });
    // Sunday is not a working day; Monday 9:00-11:00 Arizona is four slots.
    expect(slots.map((s) => s.startsAt)).toEqual([
      "2026-10-19T16:00:00.000Z",
      "2026-10-19T16:30:00.000Z",
      "2026-10-19T17:00:00.000Z",
      "2026-10-19T17:30:00.000Z",
    ]);
    expect(slots[0]!.endsAt).toBe("2026-10-19T16:30:00.000Z");
  });

  it("uses the firm's calendar day, not the UTC day, to pick the weekday", () => {
    // 23:00 Sunday in Arizona is already Monday in UTC. A Sunday-only rule must still apply to
    // Arizona's Sunday, which has no slots left that late, so the first slots are the next Sunday.
    const sunday: WeeklyRule[] = [
      { weekday: 0, startMinute: 9 * 60, endMinute: 10 * 60 },
    ];
    const slots = generateSlots({
      rules: sunday,
      now: sundayNightArizona,
      days: 8,
    });
    expect(slots[0]!.startsAt).toBe("2026-10-25T16:00:00.000Z");
  });

  it("drops slots inside the minimum lead time", () => {
    const now = new Date("2026-10-19T15:00:00Z"); // 8:00 Monday Arizona
    const slots = generateSlots({ rules: weekdays, now, days: 0 });
    // Earliest allowed start is now + 90 minutes = 16:30 UTC.
    expect(slots[0]!.startsAt).toBe("2026-10-19T16:30:00.000Z");
    expect(MIN_LEAD_MS).toBe(90 * 60 * 1000);
  });

  it("removes booked or held starts", () => {
    const slots = generateSlots({
      rules: weekdays,
      now: sundayNightArizona,
      days: 1,
      unavailable: new Set(["2026-10-19T16:30:00.000Z"]),
    });
    expect(slots.map((s) => s.startsAt)).not.toContain(
      "2026-10-19T16:30:00.000Z",
    );
    expect(slots).toHaveLength(3);
  });

  it("does not duplicate a slot covered by overlapping rules", () => {
    const slots = generateSlots({
      rules: [
        { weekday: 1, startMinute: 540, endMinute: 600 },
        { weekday: 1, startMinute: 540, endMinute: 600 },
      ],
      now: sundayNightArizona,
      days: 1,
    });
    expect(slots).toHaveLength(2);
  });

  it("returns nothing for an attorney with no hours", () => {
    expect(generateSlots({ rules: [], now: sundayNightArizona })).toEqual([]);
  });
});

describe("isBookableStart", () => {
  it("accepts only real slot starts", () => {
    const now = sundayNightArizona;
    expect(isBookableStart(weekdays, "2026-10-19T16:30:00Z", now)).toBe(true);
    // Off the half-hour grid, outside hours, and a taken slot are all refused.
    expect(isBookableStart(weekdays, "2026-10-19T16:45:00Z", now)).toBe(false);
    expect(isBookableStart(weekdays, "2026-10-19T03:00:00Z", now)).toBe(false);
    expect(
      isBookableStart(
        weekdays,
        "2026-10-19T16:30:00Z",
        now,
        new Set(["2026-10-19T16:30:00.000Z"]),
      ),
    ).toBe(false);
  });
});
