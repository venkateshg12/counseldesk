import type { PaginationQuery } from "@repo/types";
import { orm, pool } from "../prisma/db.js";
import { appAssert } from "../utils/errors/index.js";
import { CONFLICT, NOT_FOUND } from "../constants/http.js";

const pageMeta = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  hasMore: page * limit < total,
});

export const listLeads = async ({ page, limit }: PaginationQuery) => {
  const [rows, totals] = await Promise.all([
    orm.Lead.orderBy((l) => l.createdAt.desc())
      .select(
        "id",
        "conversationId",
        "name",
        "email",
        "phone",
        "caseType",
        "summary",
        "notifiedAt",
        "createdAt",
      )
      .limit(limit)
      .offset((page - 1) * limit)
      .all(),
    orm.Lead.aggregate((a) => ({ total: a.count() })),
  ]);
  return { rows, meta: pageMeta(page, limit, Number(totals.total)) };
};

type HandoffRow = {
  id: string;
  conversationId: string;
  reason: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  leadName: string | null;
  lastMessage: string | null;
};

export const listHandoffs = async ({
  page,
  limit,
  status,
}: PaginationQuery & { status: "pending" | "resolved" }) => {
  const [{ rows }, count] = await Promise.all([
    pool.query<HandoffRow>(
      `SELECT h.id, h."conversationId", h.reason, h.status, h."createdAt", h."resolvedAt",
              l.name AS "leadName",
              (SELECT left(m.content, 160) FROM "Message" m
                WHERE m."conversationId" = h."conversationId" AND m.role = 'user'
                ORDER BY m."createdAt" DESC LIMIT 1) AS "lastMessage"
       FROM "Handoff" h
       LEFT JOIN "Lead" l ON l."conversationId" = h."conversationId"
       WHERE h.status = $1
       ORDER BY h."createdAt" ${status === "pending" ? "ASC" : "DESC"}
       LIMIT $2 OFFSET $3`,
      [status, limit, (page - 1) * limit],
    ),
    pool.query<{ total: string }>(
      `SELECT count(*) AS total FROM "Handoff" WHERE status = $1`,
      [status],
    ),
  ]);
  return { rows, meta: pageMeta(page, limit, Number(count.rows[0]!.total)) };
};

export const getTranscript = async (conversationId: string) => {
  const conversation = await orm.Conversation.where({ id: conversationId })
    .select("id", "status", "createdAt", "updatedAt")
    .first();
  appAssert(conversation, NOT_FOUND, "Conversation not found");

  const [messages, lead, handoff] = await Promise.all([
    orm.Message.where({ conversationId })
      .orderBy((m) => m.createdAt.asc())
      .select(
        "id",
        "role",
        "content",
        "intent",
        "promptVersion",
        "totalMs",
        "createdAt",
      )
      .all(),
    orm.Lead.where({ conversationId }).first(),
    orm.Handoff.where({ conversationId }).first(),
  ]);

  const messageIds = messages.map((m) => m.id);
  const citations = messageIds.length
    ? await orm.MessageCitation.where((c) => c.messageId.in(messageIds))
        .orderBy((c) => c.number.asc())
        .select("messageId", "number", "url", "heading")
        .all()
    : [];

  return {
    conversation,
    lead,
    handoff,
    messages: messages.map((m) => ({
      ...m,
      citations: citations.filter((c) => c.messageId === m.id),
    })),
  };
};

export const resolveHandoff = async (
  handoffId: string,
  staffUserId: string,
) => {
  const now = new Date().toISOString();
  // Only a pending handoff can be resolved; of two simultaneous clicks, exactly one matches.
  const resolved = await orm.Handoff.where({
    id: handoffId,
    status: "pending",
  }).update({
    status: "resolved",
    resolvedAt: now,
    resolvedById: staffUserId,
  });

  if (!resolved) {
    const exists = await orm.Handoff.where({ id: handoffId })
      .select("id")
      .first();
    appAssert(exists, NOT_FOUND, "Handoff not found");
    appAssert(false, CONFLICT, "Already resolved");
  }

  await orm.Conversation.where({ id: resolved!.conversationId }).update({
    status: "closed",
    updatedAt: now,
  });
  return resolved!;
};
