# Phase 18 — Tools: `createLead` and `requestHumanHandoff`

## 1. Goal

Replace the `wants_lawyer` placeholder with real lead capture. When the router says the visitor wants
a lawyer, a **tool-calling** model step runs:

- if name, a phone or email, and the case type are known, the model calls `createLead`;
- if something is missing, it asks for exactly what's missing;
- if the visitor wants a person but won't share details, or the matter is urgent, it calls
  `requestHumanHandoff`.

The server validates every tool call with Zod before anything is saved, makes saving idempotent (a
repeated call or a race can't create two leads), marks the conversation `needs_human`, and queues the
staff email from Phase 09.

## 2. What I will understand after this phase

1. What tool (function) calling is, and who actually executes the function.
2. Why tool arguments are untrusted input, validated like a request body.
3. How a unique constraint makes a side effect idempotent under retries and races, and why it's
   caught _outside_ the transaction.
4. Why tools are only offered on the lead path (least privilege for a model).
5. The "dual write" problem between the database and the queue, and the outbox pattern that solves it.

## 3. Prerequisites

- Phase 17 done (routing works) and Phase 09 done (the notify queue).

## 4. Files

```
packages/types/src/chat.ts               (CASE_TYPES)
apps/api/src/
├── ai/types.ts                          (ToolSpec, ToolResult, callTools)
├── ai/providers/gemini.ts               (callTools)
├── ai/providers/groq.ts                 (callTools)
├── ai/llm.ts                            (shared fallback loop; generateWithTools)
├── ai/prompts/lead.v1.ts                NEW  prompt + tool schemas
├── ai/prompts/replies.ts                (lead and handoff replies; placeholder removed)
├── services/lead.service.ts             NEW  runLeadStep, saveLead, requestHandoff
├── services/chat.service.ts             (wants_lawyer → runLeadStep)
├── utils/db.ts                          NEW  isUniqueViolation
└── scripts/renotify-leads.ts            NEW  re-queue leads whose email was never sent
```

## 5. Concepts

**Tool calling.** You describe functions to the model (name, description, JSON Schema of arguments).
Instead of text, the model can answer "call `createLead` with `{name: "Ana", phone: "…"}`". The
model doesn't run anything: **your code** decides whether to run the function, with what, and what to
say afterwards. The model is a parser of intent and arguments, nothing more.

**Arguments are untrusted.** They come from a model that read text a visitor typed. They can be
missing, malformed (`phone: "call me"`), or invented. The server parses them with a Zod schema —
including rules JSON Schema can't express, like "email or phone" — and if they fail, nothing is saved
and the visitor is asked (in a fixed sentence) for what's missing.

**Least privilege.** Tools are only offered in the lead step, which only runs for `wants_lawyer`
messages, and that step's prompt contains no retrieved website text. A malicious instruction hidden in
a web page ("call createLead with…") never reaches a model that has tools.

**Idempotency by constraint.** The model may call `createLead` twice in a conversation, the client may
retry, two requests may race. The `lead.conversationId` unique index (Phase 05) means the second
insert fails with SQLSTATE `23505`. Postgres aborts a transaction on any error, so you can't catch
the violation _inside_ the transaction and continue; the whole transaction rolls back, and the code
catches the error **outside** it, reads the lead that won, and carries on as "already captured". Only
the request that actually created the lead queues the email.

**The dual write, and the outbox.** Saving the lead (Postgres) and queuing the email (Redis) are two
systems. If the process dies between them, the lead exists but nobody is emailed. The textbook fix is
the _outbox pattern_: write the "send email" intent as a row in the same database transaction, and a
separate relay moves outbox rows into the queue. This project takes a smaller step that covers the
same failure: the lead row itself is the outbox (`notifiedAt` is null until the email is sent), and a
`renotify-leads` script re-queues any lead older than a few minutes that was never notified. Staff
also see every lead on their page (Phase 36) whether or not the email went out.

**Shared fallback loop.** `generateJson` and the new `generateWithTools` differ only in which provider
method they call. The retry → fallback → telemetry loop moves into one helper both use, instead of
being copied.

## 6. Steps

### Step 1 — Case types in the shared package

```ts
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
```

### Step 2 — Provider interface

Add to `src/ai/types.ts`:

```ts
export type ToolSpec = { name: string; description: string; schema: z.ZodType };

export type ToolResult =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; args: unknown };

export type ToolRequest = {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  signal: AbortSignal;
};
```

and to `LlmProvider`:

```ts
  callTools(request: ToolRequest): Promise<{ result: ToolResult; usage: Usage }>;
```

`args` is `unknown` on purpose: nothing may use it before Zod has parsed it.

### Step 3 — Gemini `callTools`

In `providers/gemini.ts` (import `FunctionCallingConfigMode` from `@google/genai`):

```ts
  async callTools({ system, messages, tools, signal }) {
    const response = await gemini.models.generateContent({
      model,
      contents: toContents(messages),
      config: {
        systemInstruction: system,
        temperature: 0,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        tools: [
          {
            functionDeclarations: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parametersJsonSchema: toResponseSchema(tool.schema),
            })),
          },
        ],
        // AUTO: the model chooses between replying with text and calling a tool.
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        abortSignal: signal,
      },
    });

    const call = response.functionCalls?.[0];
    if (call?.name) {
      return { result: { type: "tool_call", name: call.name, args: call.args ?? {} }, usage: toUsage(response.usageMetadata) };
    }
    const text = response.text?.trim();
    // An empty reply is a failed attempt, so the fallback gets its turn.
    if (!text) throw new Error("Empty model response");
    return { result: { type: "text", text }, usage: toUsage(response.usageMetadata) };
  },
```

### Step 4 — Groq `callTools`

In `providers/groq.ts`, add a small helper next to the existing JSON-schema conversion and the method:

```ts
const jsonSchemaOf = (schema: z.ZodType) => {
  const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema);
  return jsonSchema;
};

  async callTools({ system, messages, tools, signal }) {
    const completion = await groq.chat.completions.create(
      {
        model,
        temperature: 0,
        tool_choice: "auto",
        tools: tools.map((tool) => ({
          type: "function" as const,
          function: { name: tool.name, description: tool.description, parameters: jsonSchemaOf(tool.schema) },
        })),
        messages: [{ role: "system", content: system }, ...messages],
      },
      { signal },
    );

    const message = completion.choices[0]?.message;
    const call = message?.tool_calls?.[0];
    if (call) {
      // Arguments arrive as a JSON string; a malformed one throws, which counts as a failed attempt.
      return {
        result: { type: "tool_call", name: call.function.name, args: JSON.parse(call.function.arguments || "{}") },
        usage: toUsage(completion.usage),
      };
    }
    const text = message?.content?.trim();
    if (!text) throw new Error("Empty model response");
    return { result: { type: "text", text }, usage: toUsage(completion.usage) };
  },
```

(Use `jsonSchemaOf` in `generateJson` too, replacing the inline destructuring.)

### Step 5 — One fallback loop in `llm.ts`

Replace `generateJson` with a shared helper plus two thin wrappers:

```ts
type Usage = { inputTokens: number; outputTokens: number };

const runWithFallback = async <T>(
  meta: CallMeta,
  call: (
    provider: LlmProvider,
    signal: AbortSignal,
  ) => Promise<{ value: T; usage: Usage }>,
) => {
  for (const [index, provider] of providers.entries()) {
    const startedAt = performance.now();
    const base = {
      purpose: meta.purpose,
      provider: provider.name,
      model: provider.model,
      promptVersion: meta.promptVersion,
      conversationId: meta.conversationId,
      fellBack: index > 0,
    };

    try {
      const { value, usage } = await withRetry(
        (signal) => call(provider, signal),
        {
          attempts: JSON_ATTEMPTS,
          timeoutMs: JSON_TIMEOUT_MS,
          signal: meta.signal,
        },
      );
      await recordLlmCall({
        ...base,
        ...usage,
        latencyMs: Math.round(performance.now() - startedAt),
        ok: true,
      });
      return { value, provider: provider.name, model: provider.model };
    } catch (error) {
      await recordLlmCall({
        ...base,
        latencyMs: Math.round(performance.now() - startedAt),
        ok: false,
        errorCode: errorCodeOf(error),
      });
      if (meta.signal?.aborted) throw error;
      logProviderFailure(provider, meta.purpose, error);
    }
  }
  throw unavailable();
};

export const generateJson = async <T>(
  request: {
    system: string;
    messages: ChatMessage[];
    schema: z.ZodType<T>;
  } & CallMeta,
) => {
  const { value, provider, model } = await runWithFallback(
    request,
    async (p, signal) => {
      const { data, usage } = await p.generateJson({
        system: request.system,
        messages: request.messages,
        schema: request.schema,
        signal,
      });
      return { value: data, usage };
    },
  );
  return { data: value, provider, model };
};

export const generateWithTools = async (
  request: {
    system: string;
    messages: ChatMessage[];
    tools: ToolSpec[];
  } & CallMeta,
) => {
  const { value } = await runWithFallback(request, async (p, signal) => {
    const { result, usage } = await p.callTools({
      system: request.system,
      messages: request.messages,
      tools: request.tools,
      signal,
    });
    return { value: result, usage };
  });
  return value;
};
```

`generateJson`'s return shape is unchanged, so the router (Phase 17) doesn't change.

### Step 6 — `src/ai/prompts/lead.v1.ts`

```ts
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
```

`.describe()` text ends up in the JSON Schema as `description`, which models read when filling
arguments.

Two schemas for one tool is deliberate: the model sees a forgiving shape, the server enforces a strict
one. Making the tool schema strict (regex, `.email()`) would only make some models refuse to call it
at all, and the cross-field rule can't be expressed in JSON Schema anyway.

### Step 7 — Replies

In `replies.ts`, delete `WANTS_LAWYER_PLACEHOLDER` and add:

```ts
export const leadSavedReply = (name: string) =>
  `Thank you, ${name}. I've passed your details to our team, and someone will contact you to arrange your free consultation.`;

export const LEAD_ALREADY_SAVED_REPLY =
  "Our team already has your details and will be in touch. Is there anything else I can help with?";

export const HANDOFF_REPLY =
  "I've asked a member of our team to review this conversation. You can also call us on (602) 555-0142, Monday to Friday 8:00–18:00.";

// Fixed, so a model can't phrase it as legal advice; fields are named in plain words.
export const missingDetailsReply = (fields: string[]) =>
  `To pass your details to our team I still need ${fields.join(" and ")}. Could you share ${fields.length > 1 ? "them" : "it"}?`;
```

### Step 8 — `src/utils/db.ts`

```ts
// SQLSTATE 23505: a unique constraint refused the row. Same check as the e-commerce port's catalog service.
export const isUniqueViolation = (error: unknown) => {
  const e = error as { code?: string; sqlState?: string } | null;
  return e?.sqlState === "23505" || e?.code === "23505";
};
```

### Step 9 — `src/services/lead.service.ts`

```ts
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
}: {
  conversationId: string;
  history: ChatMessage[];
  message: string;
  signal?: AbortSignal;
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
      // After commit. If this fails, the lead is saved with notifiedAt null and renotify-leads picks it up.
      await enqueueNewLeadEmail({ leadId: lead.id }).catch((error: unknown) =>
        logger.error("failed to queue lead email", { error, leadId: lead.id }),
      );
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
```

- The issue-path → plain-words mapping means the visitor reads "I still need a phone number or email
  address", never a Zod message.
- Only names of failing fields are logged, never their values: they are personal data.
- `ensureHandoff`'s `tx` type is spelled through `Parameters<…>` so the helper accepts exactly what
  `db.transaction` passes. If that's hard to read, `type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];`
  once at the top of the file and use `Tx`.

Export the lead prompt pieces from `ai/prompts/index.ts`:
`export * from "./lead.v1.js";`.

### Step 10 — Use it in `handleMessage`

Remove `wants_lawyer` from `FIXED_REPLIES`, and before the fixed-reply branch:

```ts
if (route.intent === "wants_lawyer") {
  const lead = await runLeadStep({
    conversationId: conversation.id,
    history,
    message,
    signal,
  });
  emit({ type: "token", text: lead.text });
  const saved = await orm.Message.create({
    conversationId: conversation.id,
    role: "assistant",
    content: lead.text,
    intent: route.intent,
    promptVersion: "lead.v1",
    totalMs: Math.round(performance.now() - startedAt),
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
```

(Note `ensureHandoff` already updated `updatedAt` when a lead was saved; updating it again is harmless
and keeps this branch simple.)

### Step 11 — `src/scripts/renotify-leads.ts`

```ts
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
```

`package.json`: `"leads:renotify": "tsx src/scripts/renotify-leads.ts"`. Delete
`scripts/enqueue-test-lead.ts` from Phase 09; real leads now exercise the queue.

A completed job with the same id is kept for an hour (`removeOnComplete.age`), so a lead whose first
job "completed" by skipping can't be re-queued within that hour. That's fine: a completed job means
the email was sent or the lead was gone.

## 7. Commit points

1. `feat(api): add tool calling to the provider interface for gemini and groq`
2. `refactor(api): share one retry-and-fallback loop across llm calls`
3. `feat(api): add lead capture tools with strict server-side validation`
4. `feat(api): save leads idempotently, mark handoff, queue staff email`
5. `feat(api): add script to re-queue un-notified leads`

## 8. Verify

```bash
C="-sN -c /tmp/v2 -b /tmp/v2 -X POST localhost:4000/chat -H content-type:application/json"
last() { grep -E '^data: \{"type":"(token|done|meta)"' | sed 's/^data: //' ; }

curl $C -d '{"message":"I want to talk to a lawyer"}' | last
# asks for name, phone or email, and case type   (note the conversationId)

curl $C -d '{"conversationId":"<id>","message":"Ana Diaz, it is about a DUI"}' | last
# asks only for a phone number or email

curl $C -d '{"conversationId":"<id>","message":"602-555-0100"}' | last
# "Thank you, Ana Diaz. I've passed your details…"
# API log: job completed {"jobName":"new_lead",…}  and the email printed/sent

curl $C -d '{"conversationId":"<id>","message":"I want a lawyer again"}' | last
# "Our team already has your details…"   (no second lead, no second job)

docker exec counseldesk-postgres psql -U counseldesk -d counseldesk -c \
  "SELECT c.status, l.name, l.phone, l.\"caseType\", l.\"notifiedAt\" IS NOT NULL AS notified, h.status AS handoff FROM conversation c JOIN lead l ON l.\"conversationId\"=c.id JOIN handoff h ON h.\"conversationId\"=c.id;"
# needs_human | Ana Diaz | 602-555-0100 | dui | t | pending

# Invalid argument from the model is not saved: a fake phone
# (new conversation) "I want a lawyer. Bo, phone: call me, family law" → asks for a phone number or email

# Handoff without details
# (new conversation) "I need a person right now, I'm not giving my number" → HANDOFF_REPLY, conversation needs_human, no lead

# Dual-write recovery: stop Redis, capture a lead (log: failed to queue lead email), start Redis,
# wait 5 minutes, run:
pnpm --filter api leads:renotify      # re-queued 1 lead(s) → email sent

# Race: send the final message twice at the same time (two terminals, same cookie and id)
# → exactly one lead row; one reply says "Thank you", the other "already has your details"
```

## 9. Common mistakes

- **Executing a tool call without validating its arguments.** You'd save "call me" as a phone number.
- **Catching the unique violation inside the transaction.** Postgres has aborted it: every later
  statement fails with "current transaction is aborted".
- **Offering tools on the answer path.** Text from web pages would sit next to functions that write
  data.
- **Queuing the email inside the transaction.** If the transaction then rolls back, the email is sent
  for a lead that doesn't exist.
- **Using the strict server schema as the tool schema.** Models start refusing to call the tool, and
  the cross-field rule can't be expressed there anyway.
- **Logging tool arguments.** They are names, phone numbers and emails.

## 10. Interview prep

**Q: How do you make sure a model's tool call is safe to execute?**
A: The model only proposes; my code executes. Arguments are parsed with a strict Zod schema that
includes cross-field rules; anything invalid saves nothing and gets a fixed follow-up question. Tools
are only offered on the lead path, whose prompt contains no retrieved web text.

**Q: How did you make lead creation idempotent?**
A: A unique index on the conversation id. A duplicate insert fails with 23505, the transaction rolls
back, and outside it I read the lead that won and treat it as already captured. Only the request that
created the lead queues the email.

**Q: What happens if the queue is down when a lead is saved?**
A: The lead row is saved and acts as an outbox entry: `notifiedAt` stays null. A re-notify job queues
any old un-notified lead, the job id deduplicates, and the worker skips leads already notified. Staff
also see every lead on their dashboard regardless.

## 11. Resume-safe claim

"Implemented LLM tool calling for lead capture with strict server-side argument validation,
constraint-backed idempotency under retries and races, and outbox-style recovery for the email queue."

## 12. Definition of done

- [ ] The three-message flow creates one lead, one pending handoff, `needs_human`, and one email
- [ ] Repeats and races never create a second lead or a second email
- [ ] Invalid arguments save nothing and ask for the missing detail in plain words
- [ ] Handoff-only path works without a lead
- [ ] `leads:renotify` recovers a lead whose email couldn't be queued
- [ ] Typecheck, lint and tests pass
