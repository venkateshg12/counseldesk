export const QUEUE_NAMES = {
  NOTIFY: "notify-queue",
} as const;

export const JOB_NAMES = {
  NOTIFY: {
    NEW_LEAD: "new_lead",
    PASSWORD_RESET: "password_reset",
  },
} as const;
