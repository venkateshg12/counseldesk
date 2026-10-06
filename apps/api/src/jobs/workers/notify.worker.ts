import { type Job, Worker } from "bullmq";
import { JOB_NAMES, QUEUE_NAMES } from "../../constants/queue.js";
import { processNewLead } from "../processors/notify.processor.js";
import type { NewLeadPayload } from "../interfaces/jobPayload.js";
import { redisConnection } from "../redis/connection.js";
import { logger } from "../../utils/logger.js";

export const notifyWorker = new Worker(
  QUEUE_NAMES.NOTIFY,
  async (job: Job) => {
    switch (job.name) {
      case JOB_NAMES.NOTIFY.NEW_LEAD:
        return processNewLead(job as Job<NewLeadPayload>);
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
