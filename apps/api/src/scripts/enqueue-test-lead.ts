import "dotenv/config";
import { orm } from "../prisma/db.js";
import { closeDB } from "../config/db.js";
import { enqueueNewLeadEmail } from "../jobs/producers/notify.producer.js";
import { notifyQueue } from "../jobs/queues/notify.queue.js";
import { redisConnection } from "../jobs/redis/connection.js";

// Creates a throwaway conversation + lead and queues its email. Delete once Phase 18 exists.
const conversation = await orm.Conversation.create({
  visitorId: "test-script",
});
const lead = await orm.Lead.create({
  conversationId: conversation.id,
  name: "Test Visitor",
  phone: "555-0100",
  caseType: "dui",
  summary: "Pulled over last night in Phoenix.",
});

await enqueueNewLeadEmail({ leadId: lead.id });
await enqueueNewLeadEmail({ leadId: lead.id }); // deduplicated by jobId
console.log(`Queued email for lead ${lead.id}`);

await notifyQueue.close();
await redisConnection.quit();
await closeDB();
