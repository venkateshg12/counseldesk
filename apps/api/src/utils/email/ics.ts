/*
  Builds an iCalendar (RFC 5545) invite so "Add to calendar" works in Google Calendar, Outlook and
  Apple Calendar straight from the email. Pure: no environment, no network.
 */
const CRLF = "\r\n";

// Text values escape backslash, semicolon, comma and newlines.
const escapeText = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

// Lines longer than 75 octets are folded: CRLF plus one space continues the line.
const fold = (line: string): string => {
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char);
    // The first line holds 75 octets; continuation lines hold 74 plus the leading space.
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join(CRLF + " ");
};

const formatUtc = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

export type IcsInput = {
  // Stable per appointment, so an updated or cancelled invite replaces the original.
  uid: string;
  startsAt: string;
  endsAt: string;
  summary: string;
  description?: string;
  location?: string;
  organizer: { email: string; name?: string };
  attendee: { email: string; name?: string };
  method: "REQUEST" | "CANCEL";
  // Incremented whenever the event changes.
  sequence?: number;
  now?: Date;
};

const addressLine = (
  property: "ORGANIZER" | "ATTENDEE",
  person: { email: string; name?: string },
) =>
  `${property}${person.name ? `;CN=${escapeText(person.name).replace(/[":]/g, "")}` : ""}:mailto:${person.email}`;

export const buildIcs = (input: IcsInput): string => {
  const cancelled = input.method === "CANCEL";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CounselDesk//Booking//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.method}`,
    "BEGIN:VEVENT",
    `UID:${input.uid}@counseldesk`,
    `SEQUENCE:${input.sequence ?? 0}`,
    `DTSTAMP:${formatUtc((input.now ?? new Date()).toISOString())}`,
    `DTSTART:${formatUtc(input.startsAt)}`,
    `DTEND:${formatUtc(input.endsAt)}`,
    `SUMMARY:${escapeText(input.summary)}`,
    ...(input.description
      ? [`DESCRIPTION:${escapeText(input.description)}`]
      : []),
    ...(input.location ? [`LOCATION:${escapeText(input.location)}`] : []),
    addressLine("ORGANIZER", input.organizer),
    addressLine("ATTENDEE", input.attendee),
    `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join(CRLF) + CRLF;
};
