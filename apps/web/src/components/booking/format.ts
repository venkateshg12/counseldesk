// The firm works in Arizona time; every time on the booking pages is shown in it, named, so a
// visitor in another time zone isn't left to convert.
const ZONE = "America/Phoenix";

export const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));

export const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));

export const fullLabel = (iso: string) =>
  `${dayLabel(iso)}, ${timeLabel(iso)} (Arizona time)`;

export const CASE_LABELS: Record<string, string> = {
  dui: "DUI",
  criminal_defense: "Criminal defense",
  family_law: "Family law",
  personal_injury: "Personal injury",
  estate_planning: "Wills and estate planning",
  other: "Something else",
};
