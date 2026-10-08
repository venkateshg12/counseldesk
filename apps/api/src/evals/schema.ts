import { z } from "zod";
import { CASE_TYPES, CHAT_INTENTS } from "@repo/types";

export const CASE_CATEGORIES = [
  "answerable",
  "unanswerable",
  "legal_advice",
  "wants_lawyer",
  "out_of_scope",
  "small_talk",
  "injection",
] as const;

export const evalCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  category: z.enum(CASE_CATEGORIES),
  ci: z.boolean().default(false),
  turns: z.array(z.string().min(1)).min(1),
  expect: z.object({
    intent: z.enum(CHAT_INTENTS),
    sections: z
      .array(z.string().regex(/^\/[a-z0-9/-]*#[a-z0-9-]+$/))
      .optional(),
    mustInclude: z.array(z.string()).optional(),
    mustNotInclude: z.array(z.string()).optional(),
    notFound: z.boolean().optional(),
    lead: z
      .object({
        name: z.string(),
        caseType: z.enum(CASE_TYPES),
        phone: z.string().optional(),
        email: z.string().optional(),
      })
      .optional(),
    noLead: z.boolean().optional(),
    handoff: z.boolean().optional(),
  }),
  note: z.string().optional(),
});

export type EvalCase = z.infer<typeof evalCaseSchema>;
