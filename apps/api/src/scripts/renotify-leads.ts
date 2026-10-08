import "dotenv/config";
import { orm } from "../prisma/db.js";
import { closeDB } from "../config/db.js";
import { enqueueNewLeadEmail } from "../jobs/producers/notify.producer.js";
import { notifyQueue } from "../jobs/queues/notify.queue.js";
import { redisConnection } from "../jobs/redis/connection.js";

// Re-queues leads older than 5 minutes whose email was never sent (the dual-write gap). Safe to run
// any time: the job id deduplicates, and the processor skips leads already notified.
const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
const stale = await orm.Lead.where((l) => l.notifiedAt.isNull())
  .where((l) => l.createdAt.lt(cutoff))
  .select("id")
  .all();

for (const lead of stale) await enqueueNewLeadEmail({ leadId: lead.id });
console.log(`re-queued ${stale.length} lead(s)`);

await notifyQueue.close();
await redisConnection.quit();
await closeDB();
