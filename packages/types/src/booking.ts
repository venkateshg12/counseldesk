import { z } from "zod";
import { CASE_TYPES } from "./chat.js";

export const APPOINTMENT_MODES = ["video", "in_person"] as const;
export type AppointmentMode = (typeof APPOINTMENT_MODES)[number];

export const APPOINTMENT_STATUSES = [
  "booked",
  "cancelled",
  "completed",
  "no_show",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

// One bookable start time. `startsAt` is an ISO instant; the site shows it in the firm's time zone.
export type Slot = { startsAt: string; endsAt: string };

export type SlotsResponse = {
  attorney: { id: string; name: string; slug: string };
  timeZone: string;
  slots: Slot[];
};

export const slotsQuerySchema = z.object({
  caseType: z.enum(CASE_TYPES),
  // Optional: ask for a specific attorney (used when rescheduling).
  attorneyId: z.uuid().optional(),
});
export type SlotsQuery = z.infer<typeof slotsQuerySchema>;

const contactFields = {
  name: z.string().trim().min(1, "Enter your name").max(100),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  phone: z
    .string()
    .trim()
    .regex(/^[+()\d\s.-]{7,20}$/, "Enter a valid phone number")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  summary: z.string().trim().max(500).optional(),
  mode: z.enum(APPOINTMENT_MODES).default("video"),
};

export const holdRequestSchema = z.object({
  attorneyId: z.uuid(),
  startsAt: z.iso.datetime(),
});
export type HoldRequest = z.infer<typeof holdRequestSchema>;

export const createAppointmentSchema = z.object({
  ...contactFields,
  caseType: z.enum(CASE_TYPES),
  attorneyId: z.uuid(),
  startsAt: z.iso.datetime(),
  // Proves the visitor reserved this slot in the last few minutes.
  holdToken: z.string().min(16).max(64),
});
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

export const manageTokenQuerySchema = z.object({
  token: z.string().min(20).max(300),
});

export const rescheduleSchema = z.object({
  startsAt: z.iso.datetime(),
  holdToken: z.string().min(16).max(64),
});
export type RescheduleInput = z.infer<typeof rescheduleSchema>;

// What a visitor sees after booking, and on the manage page.
export type AppointmentView = {
  id: string;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  mode: AppointmentMode;
  caseType: (typeof CASE_TYPES)[number];
  attorney: { id: string; name: string; slug: string };
};

export type CreatedAppointment = AppointmentView & { manageToken: string };

// Chat: book the slot the visitor tapped, using the lead already saved for the conversation.
export const chatBookSchema = z.object({
  startsAt: z.iso.datetime(),
  mode: z.enum(APPOINTMENT_MODES).default("video"),
});

// ---------- Staff ----------

export const staffAppointmentsQuerySchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  attorneyId: z.uuid().optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
});

export const staffAppointmentUpdateSchema = z.object({
  status: z.enum(["completed", "no_show", "cancelled"]),
});

export const assignLeadSchema = z.object({ attorneyId: z.uuid() });

export const availabilityRuleSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine((r) => r.endMinute > r.startMinute, "End must be after start");

export const availabilityUpdateSchema = z.object({
  rules: z.array(availabilityRuleSchema).max(21),
});
export type AvailabilityRuleInput = z.infer<typeof availabilityRuleSchema>;

export type StaffAppointment = {
  id: string;
  attorneyId: string;
  attorneyName: string;
  name: string;
  email: string | null;
  phone: string | null;
  caseType: string;
  summary: string | null;
  mode: AppointmentMode;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
};

export type StaffAttorney = {
  id: string;
  slug: string;
  name: string;
  email: string;
  active: boolean;
  practiceAreas: string[];
  availability: AvailabilityRuleInput[];
};
