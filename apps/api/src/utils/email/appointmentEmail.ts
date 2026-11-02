import { SITE_URL, STAFF_APP_URL } from "../../constants/env.js";
import { FIRM_TIME_ZONE } from "../booking/slots.js";
import { escapeHtml } from "./leadEmail.js";

/*
  Every email about an appointment or a lead acknowledgement. Visitor-supplied text goes into HTML,
  so it is escaped; times are always shown in the firm's time zone with its name, so nobody has to
  convert.
 */
export const formatWhen = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: FIRM_TIME_ZONE,
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(iso)) + " (Arizona time)";

type AppointmentEmailInput = {
  name: string;
  startsAt: string;
  mode: "video" | "in_person";
  caseType: string;
  attorneyName: string;
};

const modeText = (mode: AppointmentEmailInput["mode"]) =>
  mode === "video"
    ? "By video call. The attorney's office will send the link."
    : "In person at the firm's office.";

const wrap = (
  paragraphs: string[],
  link?: { href: string; label: string },
) => ({
  text: `${paragraphs.join("\n\n")}${link ? `\n\n${link.label}: ${link.href}` : ""}`,
  html: `${paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("")}${
    link ? `<p><a href="${link.href}">${escapeHtml(link.label)}</a></p>` : ""
  }`,
});

export const manageUrl = (appointmentId: string, token: string) =>
  `${SITE_URL}/book/manage/${appointmentId}?token=${encodeURIComponent(token)}`;

export const getAppointmentConfirmationEmail = (
  appt: AppointmentEmailInput,
  manageLink: string,
  rescheduled: boolean,
) => ({
  subject: rescheduled
    ? "Your consultation has been moved"
    : "Your free consultation is booked",
  ...wrap(
    [
      `Hi ${appt.name},`,
      `${rescheduled ? "Your consultation has a new time" : "You're booked"}: ${formatWhen(appt.startsAt)} with ${appt.attorneyName}.`,
      `${modeText(appt.mode)} It lasts 30 minutes and it's free. The invite attached adds it to your calendar.`,
      "Need to change it? Use the link below to reschedule or cancel. This is not legal advice, just your booking.",
    ],
    { href: manageLink, label: "Reschedule or cancel" },
  ),
});

export const getAttorneyAppointmentEmail = (
  appt: AppointmentEmailInput & {
    id: string;
    email: string | null;
    phone: string | null;
    summary: string | null;
  },
  rescheduled: boolean,
) => ({
  subject: `${rescheduled ? "Moved" : "New"} consultation: ${appt.name} (${appt.caseType})`,
  ...wrap(
    [
      `${rescheduled ? "Rescheduled" : "New"} consultation with ${appt.name}.`,
      `When: ${formatWhen(appt.startsAt)}`,
      `Email: ${appt.email ?? "—"}\nPhone: ${appt.phone ?? "—"}\nCase type: ${appt.caseType}\nFormat: ${appt.mode === "video" ? "Video" : "In person"}\nWhat they said: ${appt.summary ?? "—"}`,
    ],
    {
      href: `${STAFF_APP_URL}/staff/appointments`,
      label: "Open the appointments page",
    },
  ),
});

export const getAppointmentReminderEmail = (
  appt: AppointmentEmailInput,
  manageLink: string,
) => ({
  subject: "Reminder: your consultation is tomorrow",
  ...wrap(
    [
      `Hi ${appt.name},`,
      `A reminder that your free consultation with ${appt.attorneyName} is on ${formatWhen(appt.startsAt)}.`,
      "If you can't make it, please cancel or reschedule so someone else can have the time.",
    ],
    { href: manageLink, label: "Reschedule or cancel" },
  ),
});

export const getAppointmentCancelledEmail = (
  appt: AppointmentEmailInput,
  audience: "visitor" | "attorney",
) => ({
  subject: `Consultation cancelled: ${formatWhen(appt.startsAt)}`,
  ...wrap(
    audience === "visitor"
      ? [
          `Hi ${appt.name},`,
          `Your consultation with ${appt.attorneyName} on ${formatWhen(appt.startsAt)} has been cancelled.`,
          "You can book a new time whenever you like.",
        ]
      : [
          `The consultation with ${appt.name} on ${formatWhen(appt.startsAt)} was cancelled.`,
        ],
    audience === "visitor"
      ? { href: `${SITE_URL}/book`, label: "Book a new time" }
      : undefined,
  ),
});

export const getLeadAckEmail = (lead: {
  name: string;
  attorneyName: string | null;
}) => ({
  subject: "We got your request",
  ...wrap(
    [
      `Hi ${lead.name},`,
      lead.attorneyName
        ? `Thanks for reaching out. ${lead.attorneyName} will contact you soon.`
        : "Thanks for reaching out. A member of our team will contact you soon.",
      "Want to talk sooner? You can pick a free 30-minute consultation time yourself.",
    ],
    { href: `${SITE_URL}/book`, label: "Book a free consultation" },
  ),
});
