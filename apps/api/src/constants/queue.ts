export const QUEUE_NAMES = {
  NOTIFY: "notify-queue",
} as const;

export const JOB_NAMES = {
  NOTIFY: {
    NEW_LEAD: "new_lead",
    PASSWORD_RESET: "password_reset",
    LEAD_ACK: "lead_ack",
    APPOINTMENT_CONFIRMATION: "appointment_confirmation",
    APPOINTMENT_ATTORNEY_NOTICE: "appointment_attorney_notice",
    APPOINTMENT_REMINDER: "appointment_reminder",
    APPOINTMENT_CANCELLED: "appointment_cancelled",
  },
} as const;
