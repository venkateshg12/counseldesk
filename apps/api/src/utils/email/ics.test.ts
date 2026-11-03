import { describe, expect, it } from "vitest";
import { buildIcs } from "./ics.js";

const base = {
  uid: "abc",
  startsAt: "2026-10-19T16:00:00.000Z",
  endsAt: "2026-10-19T16:30:00.000Z",
  summary: "Consultation",
  organizer: { email: "firm@firm.test", name: "Harbor & Vale Law" },
  attendee: { email: "visitor@test.dev", name: "Visitor" },
  now: new Date("2026-10-18T10:00:00Z"),
};

describe("buildIcs", () => {
  it("builds a REQUEST invite with UTC times and CRLF line endings", () => {
    const ics = buildIcs({ ...base, method: "REQUEST" });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("UID:abc@counseldesk");
    expect(ics).toContain("DTSTART:20261019T160000Z");
    expect(ics).toContain("DTEND:20261019T163000Z");
    expect(ics).toContain("DTSTAMP:20261018T100000Z");
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  it("marks a CANCEL as cancelled and keeps the same UID", () => {
    const ics = buildIcs({ ...base, method: "CANCEL", sequence: 1 });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SEQUENCE:1");
    expect(ics).toContain("UID:abc@counseldesk");
  });

  it("escapes special characters so visitor text can't add calendar lines", () => {
    const ics = buildIcs({
      ...base,
      method: "REQUEST",
      description: "a, b; c\nEND:VEVENT\nSTATUS:CANCELLED",
    });
    expect(ics).toContain(
      "DESCRIPTION:a\\, b\\; c\\nEND:VEVENT\\nSTATUS:CANCELLED",
    );
    expect(ics.match(/^END:VEVENT$/gm)).toHaveLength(1);
  });

  it("folds lines longer than 75 octets", () => {
    const ics = buildIcs({
      ...base,
      method: "REQUEST",
      description: "x".repeat(200),
    });
    for (const line of ics.split("\r\n")) {
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    }
    expect(ics).toContain("\r\n x");
  });
});
