import { type Job, Worker } from "bullmq";
import { JOB_NAMES, QUEUE_NAMES } from "../../constants/queue.js";
import {
  processAppointmentAttorneyNotice,
  processAppointmentCancelled,
  processAppointmentConfirmation,
  processAppointmentReminder,
  processLeadAck,
  processNewLead,
  processPasswordReset,
} from "../processors/notify.processor.js";
import type {
  AppointmentPayload,
  AppointmentReminderPayload,
  LeadAckPayload,
  NewLeadPayload,
  PasswordResetPayload,
} from "../interfaces/jobPayload.js";
import { redisConnection } from "../redis/connection.js";
import { logger } from "../../utils/logger.js";

export const notifyWorker = new Worker(
  QUEUE_NAMES.NOTIFY,
  async (job: Job) => {
    switch (job.name) {
      case JOB_NAMES.NOTIFY.NEW_LEAD:
        return processNewLead(job as Job<NewLeadPayload>);
      case JOB_NAMES.NOTIFY.PASSWORD_RESET:
        return processPasswordReset(job as Job<PasswordResetPayload>);
      case JOB_NAMES.NOTIFY.LEAD_ACK:
        return processLeadAck(job as Job<LeadAckPayload>);
      case JOB_NAMES.NOTIFY.APPOINTMENT_CONFIRMATION:
        return processAppointmentConfirmation(job as Job<AppointmentPayload>);
      case JOB_NAMES.NOTIFY.APPOINTMENT_ATTORNEY_NOTICE:
        return processAppointmentAttorneyNotice(job as Job<AppointmentPayload>);
      case JOB_NAMES.NOTIFY.APPOINTMENT_REMINDER:
        return processAppointmentReminder(
          job as Job<AppointmentReminderPayload>,
        );
      case JOB_NAMES.NOTIFY.APPOINTMENT_CANCELLED:
        return processAppointmentCancelled(job as Job<AppointmentPayload>);
      default:
        throw new Error(`Unknown job name: ${job.name}`);
    }
  },
  {
    connection: redisConnection,
    concurrency: 2,
    lockDuration: 30000,
    limiter: { max: 2, duration: 1000 },
  },
);

notifyWorker.on("completed", (job, result) =>
  logger.info("job completed", { jobId: job.id, jobName: job.name, result }),
);
notifyWorker.on("failed", (job, error) =>
  logger.error("job failed", {
    jobId: job?.id,
    jobName: job?.name,
    attempt: job?.attemptsMade,
    error,
  }),
);
notifyWorker.on("stalled", (jobId) => logger.warn("job stalled", { jobId }));
notifyWorker.on("error", (error) =>
  logger.error("worker connection error", { error }),
);
