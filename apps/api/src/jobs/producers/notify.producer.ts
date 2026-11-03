import { JOB_NAMES } from "../../constants/queue.js";
import type {
  AppointmentPayload,
  AppointmentReminderPayload,
  LeadAckPayload,
  NewLeadPayload,
  PasswordResetPayload,
} from "../interfaces/jobPayload.js";
import { notifyQueue } from "../queues/notify.queue.js";

export const enqueueNewLeadEmail = (payload: NewLeadPayload) =>
  notifyQueue.add(JOB_NAMES.NOTIFY.NEW_LEAD, payload, {
    // Deduplicates: a second call for the same lead queues nothing.
    jobId: `lead:${payload.leadId}:email`,
  });

export const enqueuePasswordResetEmail = (payload: PasswordResetPayload) =>
  notifyQueue.add(JOB_NAMES.NOTIFY.PASSWORD_RESET, payload, {
    jobId: `reset:${payload.userId}:${payload.issuedAt}`,
  });

export const enqueueLeadAck = (payload: LeadAckPayload) =>
  notifyQueue.add(JOB_NAMES.NOTIFY.LEAD_ACK, payload, {
    jobId: `lead-${payload.leadId}-ack`,
  });

// `version` is the appointment's link version: a rescheduled appointment gets fresh emails.
export const enqueueAppointmentConfirmation = (
  payload: AppointmentPayload,
  version: number,
) =>
  notifyQueue.add(JOB_NAMES.NOTIFY.APPOINTMENT_CONFIRMATION, payload, {
    jobId: `appt-${payload.appointmentId}-v${version}-confirm`,
  });

export const enqueueAppointmentAttorneyNotice = (
  payload: AppointmentPayload,
  version: number,
) =>
  notifyQueue.add(JOB_NAMES.NOTIFY.APPOINTMENT_ATTORNEY_NOTICE, payload, {
    jobId: `appt-${payload.appointmentId}-v${version}-attorney`,
  });

export const reminderJobId = (appointmentId: string, linkVersion: number) =>
  `appt-${appointmentId}-v${linkVersion}-reminder`;

// Sent one day before the appointment; skipped if the appointment is already inside that window.
export const enqueueAppointmentReminder = (
  payload: AppointmentReminderPayload,
  delayMs: number,
) =>
  notifyQueue.add(JOB_NAMES.NOTIFY.APPOINTMENT_REMINDER, payload, {
    jobId: reminderJobId(payload.appointmentId, payload.linkVersion),
    delay: Math.max(0, delayMs),
  });

export const removeAppointmentReminder = async (
  appointmentId: string,
  linkVersion: number,
) => {
  const job = await notifyQueue.getJob(
    reminderJobId(appointmentId, linkVersion),
  );
  await job?.remove().catch(() => undefined);
};

// `version` keeps a cancel email for a later cancel of a rescheduled appointment from deduplicating.
export const enqueueAppointmentCancelled = (
  payload: AppointmentPayload,
  version: number,
) =>
  notifyQueue.add(JOB_NAMES.NOTIFY.APPOINTMENT_CANCELLED, payload, {
    jobId: `appt-${payload.appointmentId}-v${version}-cancelled`,
  });
