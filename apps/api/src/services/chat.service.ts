import type { ChatEvent, ChatIntent } from "@repo/types";
import { db, orm } from "../prisma/db.js";
import { appAssert } from "../utils/errors/index.js";
import { NOT_FOUND, TOO_MANY_REQUESTS } from "../constants/http.js";
import { appErrorCode } from "../constants/appErrorCode.js";
import { prepareAnswer } from "./answer.service.js";
import { streamText } from "../ai/llm.js";
import {
  LEGAL_ADVICE_REPLY,
  NOTICE,
  NOT_FOUND_REPLY,
  OUT_OF_SCOPE_REPLY,
  SMALL_TALK_REPLY,
} from "../ai/prompts/index.js";
import { extractCitations } from "../utils/citations.js";
import type { ChatMessage } from "../ai/types.js";
import type { SearchMode } from "../constants/search.js";
import { routeMessage } from "./router.service.js";
import { runLeadStep } from "./lead.service.js";
import { getRequestId } from "../utils/requestContext.js";

// Earlier turns given to the model and the router. Six messages = three exchanges.
const HISTORY_MESSAGES = 6;

const FIXED_REPLIES: Partial<Record<ChatIntent, string>> = {
  legal_advice: LEGAL_ADVICE_REPLY,
  out_of_scope: OUT_OF_SCOPE_REPLY,
  small_talk: SMALL_TALK_REPLY,
};

type HandleMessageInput = {
  visitorId: string;
  conversationId?: string;
  message: string;
  signal: AbortSignal;
  emit: (event: ChatEvent) => void;
  // Evals only: run retrieval in one mode (Phase 23).
  mode?: SearchMode;
  notifyStaff?: boolean;
};

const loadHistory = async (conversationId: string): Promise<ChatMessage[]> => {
  const recent = await orm.Message.where({ conversationId })
    .orderBy((m) => m.createdAt.desc())
    .select("role", "content")
    .limit(HISTORY_MESSAGES)
    .all();
  return recent.reverse();
};

export const handleMessage = async ({
  visitorId,
  conversationId,
  message,
  signal,
  emit,
  mode,
  notifyStaff = true,
}: HandleMessageInput) => {
  const startedAt = performance.now();

  // A visitor may only continue a conversation their own browser started.
  const conversation = conversationId
    ? await orm.Conversation.where({ id: conversationId, visitorId }).first()
    : await orm.Conversation.create({ visitorId });
  appAssert(conversation, NOT_FOUND, "Conversation not found");
  emit({ type: "meta", conversationId: conversation.id });

  // A very long conversation is either a script or a context window about to overflow. Ask for a new one.
  const MAX_USER_MESSAGES = 30;
  const userMessages = await orm.Message.where({
    conversationId: conversation.id,
    role: "user",
  }).aggregate((a) => ({ n: a.count() }));
  appAssert(
    Number(userMessages.n) < MAX_USER_MESSAGES,
    TOO_MANY_REQUESTS,
    "This conversation is very long. Please start a new one.",
    appErrorCode.ConversationTooLong,
  );

  const history = await loadHistory(conversation.id);
  await orm.Message.create({
    conversationId: conversation.id,
    role: "user",
    content: message,
  });

  const route = await routeMessage({
    message,
    history,
    conversationId: conversation.id,
    signal,
  });

  if (route.intent === "wants_lawyer") {
    const lead = await runLeadStep({
      conversationId: conversation.id,
      history,
      message,
      signal,
      notifyStaff,
    });
    emit({ type: "token", text: lead.text });
    const saved = await orm.Message.create({
      conversationId: conversation.id,
      role: "assistant",
      content: lead.text,
      intent: route.intent,
      promptVersion: "lead.v1",
      totalMs: Math.round(performance.now() - startedAt),
      requestId: getRequestId(),
      routeMs: route.routeMs,
    });
    await orm.Conversation.where({ id: conversation.id }).update({
      updatedAt: new Date().toISOString(),
    });
    emit({ type: "citations", citations: [] });
    emit({
      type: "done",
      messageId: saved.id,
      intent: route.intent,
      notice: null,
      degraded: false,
    });
    return {
      conversationId: conversation.id,
      messageId: saved.id,
      text: lead.text,
      citations: [],
      intent: route.intent,
      leadAction: lead.action,
      prepared: null,
      totalMs: 0,
      firstTokenMs: null,
    };
  }

  const fixedReply = FIXED_REPLIES[route.intent];
  if (fixedReply) {
    emit({ type: "token", text: fixedReply });
    const saved = await orm.Message.create({
      conversationId: conversation.id,
      role: "assistant",
      content: fixedReply,
      intent: route.intent,
      totalMs: Math.round(performance.now() - startedAt),
      requestId: getRequestId(),
      routeMs: route.routeMs,
    });
    await orm.Conversation.where({ id: conversation.id }).update({
      updatedAt: new Date().toISOString(),
    });
    emit({ type: "citations", citations: [] });
    emit({
      type: "done",
      messageId: saved.id,
      intent: route.intent,
      notice: null,
      degraded: false,
    });
    return {
      conversationId: conversation.id,
      messageId: saved.id,
      text: fixedReply,
      citations: [],
      intent: route.intent,
      prepared: null,
      totalMs: 0,
      firstTokenMs: null,
    };
  }

  const prepared = await prepareAnswer({ question: message, history, mode });

  let text = "";
  let firstTokenMs: number | null = null;

  if (prepared.sources.length === 0) {
    // Nothing to ground on: skip the model entirely.
    text = NOT_FOUND_REPLY;
    emit({ type: "token", text });
  } else {
    for await (const event of streamText({
      purpose: "answer",
      promptVersion: prepared.promptVersion,
      conversationId: conversation.id,
      system: prepared.system,
      messages: prepared.messages,
      signal,
    })) {
      if (event.type === "text") {
        if (firstTokenMs === null)
          firstTokenMs = Math.round(performance.now() - startedAt);
        text += event.text;
        emit({ type: "token", text: event.text });
      }
    }
  }

  // The visitor left mid-answer: nothing is saved for an answer nobody saw.
  if (signal.aborted) return null;

  const citations = extractCitations(text, prepared.sources);
  const totalMs = Math.round(performance.now() - startedAt);

  const assistantMessage = await db.transaction(async (tx) => {
    const saved = await tx.orm.public.Message.create({
      conversationId: conversation.id,
      role: "assistant",
      content: text,
      intent: route.intent,
      promptVersion: prepared.promptVersion,
      retrieveMs: prepared.retrieveMs,
      firstTokenMs,
      totalMs,
      requestId: getRequestId(),
      routeMs: route.routeMs,
    });
    for (const citation of citations) {
      await tx.orm.public.MessageCitation.create({
        messageId: saved.id,
        sectionId: citation.sectionId,
        number: citation.number,
        url: citation.url,
        heading: citation.heading,
      });
    }
    await tx.orm.public.Conversation.where({ id: conversation.id }).update({
      updatedAt: new Date().toISOString(),
    });
    return saved;
  });

  emit({
    type: "citations",
    citations: citations.map(({ number, url, heading }) => ({
      number,
      url,
      heading,
    })),
  });
  emit({
    type: "done",
    messageId: assistantMessage.id,
    intent: route.intent,
    notice: NOTICE,
    degraded: prepared.retrieval.degraded,
  });

  return {
    conversationId: conversation.id,
    messageId: assistantMessage.id,
    text,
    citations,
    intent: route.intent,
    prepared,
    totalMs,
    firstTokenMs,
  };
};
