import { z } from "zod";

// One citation as shown to the visitor: [number] links to the exact section of the firm's site.
export type Citation = {
  number: number;
  url: string;
  heading: string;
};

export const chatRequestSchema = z.object({
  conversationId: z.uuid().optional(),
  message: z
    .string()
    .trim()
    .min(1, { message: "Message is empty" })
    .max(1000, { message: "Message is too long" }),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const CHAT_INTENTS = [
  "question",
  "legal_advice",
  "wants_lawyer",
  "out_of_scope",
  "small_talk",
] as const;
export type ChatIntent = (typeof CHAT_INTENTS)[number];

// Everything the chat stream can send, in order: meta, token*, citations, done — or error at any point.
export type ChatEvent =
  | { type: "meta"; conversationId: string }
  | { type: "token"; text: string }
  | { type: "citations"; citations: Citation[] }
  | {
      type: "done";
      messageId: string;
      intent: ChatIntent | null;
      notice: string | null;
      degraded: boolean;
    }
  | { type: "error"; message: string; code: string };

// Must match the CaseType enum in the API's contract.prisma.
export const CASE_TYPES = [
  "dui",
  "criminal_defense",
  "family_law",
  "personal_injury",
  "estate_planning",
  "other",
] as const;
export type CaseType = (typeof CASE_TYPES)[number];
