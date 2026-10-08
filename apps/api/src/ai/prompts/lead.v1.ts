import { z } from "zod";
import { CASE_TYPES } from "@repo/types";

// What the model is told the arguments look like (JSON Schema can't say "email OR phone").
const createLeadToolSchema = z.object({
  name: z.string().describe("The visitor's full name as they gave it."),
  email: z.string().optional().describe("Email address, if given."),
  phone: z.string().optional().describe("Phone number, if given."),
  caseType: z.enum(CASE_TYPES).describe("The type of legal matter."),
  summary: z
    .string()
    .optional()
    .describe("One sentence about their situation, only if they described it."),
});

// What the server accepts. Stricter, and includes the cross-field rule.
export const createLeadArgsSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().email().max(255).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^[+()\d\s.-]{7,20}$/, { message: "phone" })
      .optional(),
    caseType: z.enum(CASE_TYPES),
    summary: z.string().trim().max(500).optional(),
  })
  .refine((lead) => lead.email || lead.phone, {
    message: "contact",
    path: ["phone"],
  });

export type CreateLeadArgs = z.infer<typeof createLeadArgsSchema>;

export const handoffArgsSchema = z.object({
  reason: z.string().trim().min(1).max(300),
});

export const LEAD_TOOLS = [
  {
    name: "createLead",
    description:
      "Save the visitor's contact details so the firm's team can contact them. Call only when you have their name, a phone number or email, and the case type.",
    schema: createLeadToolSchema,
  },
  {
    name: "requestHumanHandoff",
    description:
      "Flag this conversation for a staff member when the visitor wants a person but will not share contact details, or the matter is urgent.",
    schema: handoffArgsSchema,
  },
];

export const leadV1 = {
  version: "lead.v1",
  system: `You help a visitor of Harbor & Vale Law, a law firm in Phoenix, Arizona, get in touch with the firm's team.

You need three things: the visitor's name, a phone number or an email address, and the type of case (DUI, criminal defense, family law, personal injury, estate planning, or other).
- If anything is missing, ask for only the missing items, in one short, friendly message.
- When you have all three, call createLead. Add a one-sentence summary only if the visitor described their situation.
- If the visitor wants to speak to a person but refuses to share contact details, or says the matter is urgent, call requestHumanHandoff with a short reason.
- Never give legal advice. Never invent details the visitor did not give. Use only what is in this conversation.`,
};
