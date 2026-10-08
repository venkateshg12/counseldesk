import { db, orm } from "../prisma/db.js";
import { generateWithTools } from "../ai/llm.js";
import {
  createLeadArgsSchema,
  handoffArgsSchema,
  HANDOFF_REPLY,
  LEAD_ALREADY_SAVED_REPLY,
  LEAD_TOOLS,
  leadSavedReply,
  leadV1,
  missingDetailsReply,
  type CreateLeadArgs,
} from "../ai/prompts/index.js";
import type { ChatMessage } from "../ai/types.js";
import { enqueueNewLeadEmail } from "../jobs/producers/notify.producer.js";
import { isUniqueViolation } from "../utils/db.js";
import { logger } from "../utils/logger.js";

const FIELD_NAMES: Record<string, string> = {
  name: "your name",
  phone: "a phone number or email address",
  email: "a valid email address",
  caseType: "the type of case",
};

// Marks the conversation for a human and creates its handoff if it doesn't have one yet.
const ensureHandoff = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  conversationId: string,
  reason: string,
) => {
  const existing = await tx.orm.public.Handoff.where({ conversationId })
    .select("id")
    .first();
  if (!existing) await tx.orm.public.Handoff.create({ conversationId, reason });
  await tx.orm.public.Conversation.where({ id: conversationId }).update({
    status: "needs_human",
    updatedAt: new Date().toISOString(),
  });
};

// Idempotent: a second call (retry, duplicate tool call, concurrent request) returns the existing lead.
export const saveLead = async (
  conversationId: string,
  args: CreateLeadArgs,
) => {
  try {
    const lead = await db.transaction(async (tx) => {
      const created = await tx.orm.public.Lead.create({
        conversationId,
        ...args,
      });
      await ensureHandoff(tx, conversationId, `New lead: ${args.caseType}`);
      return created;
    });
    return { lead, created: true };
  } catch (error) {
    // The unique index on lead.conversationId refused a second lead. The transaction already rolled
    // back (Postgres aborts it on any error), so the existing lead is read outside it.
    if (!isUniqueViolation(error)) throw error;
    const lead = await orm.Lead.where({ conversationId }).first();
    return { lead: lead!, created: false };
  }
};

export const requestHandoff = async (
  conversationId: string,
  reason: string,
) => {
  await db.transaction((tx) => ensureHandoff(tx, conversationId, reason));
};

export const runLeadStep = async ({
  conversationId,
  history,
  message,
  signal,
  notifyStaff = true,
}: {
  conversationId: string;
  history: ChatMessage[];
  message: string;
  signal?: AbortSignal;
  notifyStaff?: boolean;
}): Promise<{
  text: string;
  action: "lead_created" | "lead_exists" | "handoff" | null;
}> => {
  if (await orm.Lead.where({ conversationId }).select("id").first()) {
    return { text: LEAD_ALREADY_SAVED_REPLY, action: "lead_exists" };
  }

  const result = await generateWithTools({
    purpose: "lead",
    promptVersion: leadV1.version,
    conversationId,
    signal,
    system: leadV1.system,
    messages: [...history, { role: "user", content: message }],
    tools: LEAD_TOOLS,
  });

  if (result.type === "text") return { text: result.text, action: null };

  if (result.name === "createLead") {
    const parsed = createLeadArgsSchema.safeParse(result.args);
    if (!parsed.success) {
      const fields = [
        ...new Set(
          parsed.error.issues.map(
            (issue) => FIELD_NAMES[String(issue.path[0])] ?? "your details",
          ),
        ),
      ];
      logger.info("lead tool call rejected", {
        conversationId,
        issues: parsed.error.issues.map((i) => i.path.join(".")),
      });
      return { text: missingDetailsReply(fields), action: null };
    }

    const { lead, created } = await saveLead(conversationId, parsed.data);
    if (created) {
      if (notifyStaff) {
        // After commit. If this fails, the lead is saved with notifiedAt null and renotify-leads picks it up.
        await enqueueNewLeadEmail({ leadId: lead.id }).catch((error: unknown) =>
          logger.error("failed to queue lead email", {
            error,
            leadId: lead.id,
          }),
        );
      }
      return { text: leadSavedReply(lead.name), action: "lead_created" };
    }
    return { text: LEAD_ALREADY_SAVED_REPLY, action: "lead_exists" };
  }

  if (result.name === "requestHumanHandoff") {
    const parsed = handoffArgsSchema.safeParse(result.args);
    await requestHandoff(
      conversationId,
      parsed.success ? parsed.data.reason : "Visitor asked for a person",
    );
    return { text: HANDOFF_REPLY, action: "handoff" };
  }

  // A tool we didn't offer: never executed.
  logger.warn("unknown tool requested", { conversationId, tool: result.name });
  return {
    text: missingDetailsReply([
      "your name",
      "a phone number or email address",
      "the type of case",
    ]),
    action: null,
  };
};
