# Phase 05 — Application schema: conversations, leads, handoffs and LLM call logs

## 1. Goal

Add every table the chat itself needs, in one reviewed migration:

| Table             | Holds                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------- |
| `conversation`    | one chat session with a visitor, and whether it needs a human                          |
| `message`         | each visitor question and assistant answer, with timings                               |
| `messageCitation` | which section each `[n]` in an answer pointed to                                       |
| `lead`            | a captured contact: name, email and/or phone, case type                                |
| `handoff`         | a request for a human, and whether staff resolved it                                   |
| `llmCall`         | one row per model call: provider, model, prompt version, tokens, latency, cost, status |

Designing them together, before any chat code exists, is the same choice the e-commerce Postgres
port made ("Phase 1 does the schema in one pass, on purpose"): relationships and constraints are
easier to get right when you can see all of them at once.

## 2. What I will understand after this phase

1. How to turn business rules into database constraints ("a lead must have a way to contact them",
   "one lead per conversation") so a bug in application code can't break them.
2. When to use `Cascade`, `SetNull` or the default `Restrict` on a foreign key.
3. Why citations are a table instead of a JSON blob.
4. What to record about every LLM call so cost, latency and failures are measurable later.

## 3. Prerequisites

- Phase 04 done.

## 4. Files

```
apps/api/
├── src/prisma/contract.prisma        (6 models, 5 enums)
├── src/prisma/contract.json|d.ts     (re-emitted)
└── migrations/app/*_add_chat_tables/ generated
```

## 5. Concepts

**Constraints over code.** "A lead needs an email or a phone" could be an `if` in a service. A
`CHECK` constraint makes the database itself refuse a row that breaks it — whatever code path wrote
it, including a buggy tool call from the model. Same for "one lead per conversation": a unique index
on `lead.conversationId` makes a duplicate insert fail even if two requests race. The e-commerce
port's README calls this "constraints replace application checks".

**Foreign-key delete behaviour.**

- `Cascade` (`message → conversation`): a message can't exist without its conversation.
- `SetNull` (`messageCitation.sectionId`): if ingestion deletes a section because a heading was
  removed from the site, past answers should keep their citation row (with the snapshot of what it
  said), just without the link.
- `Restrict` (the default): refuse the delete. Not used here: it fits rows that must never lose
  their parent (an invoice's customer). Even "which staff member resolved this handoff" (Phase 19)
  uses `SetNull`, so removing a staff account doesn't require deleting history first.

**Citations as rows, with a snapshot.** Storing `[{n:1, sectionId:…}]` as JSON would work until you
want to ask "how often is the fees section cited?" or "did answer X cite section Y?" — which is
exactly what the eval suite asks. A table answers those with a join. Each row also stores the URL and
heading **as they were when the answer was given**, so a transcript still makes sense after the
site changes.

**Enums stored as text.** Like the port (`@@type("pg/text@1")`), enum values are stored as plain
text with a generated `CHECK` constraint listing the allowed values. Adding a value later is an easy
migration, unlike Postgres's native `ENUM` type.

**What an LLM call row records.** Each model call (routing, answering, lead extraction, embedding)
writes: which provider and model answered (the fallback may have been used), which prompt version,
input and output tokens, total latency and time to first token, an estimated cost, and whether it
failed. Phase 20 builds the cost and latency reports from this table, and Phase 22 reads it to score
evals. Money is stored as an integer number of **micro-dollars** (millionths of a US dollar): the same
"never a float for money" rule as the port's paise, scaled down because one call costs fractions of
a cent.

## 6. Steps

### Step 1 — Enums

Add to `contract.prisma` (the `@@type` line and the blank line after it are the port's style):

```prisma
enum ConversationStatus {
    @@type("pg/text@1")

    open
    needs_human
    closed
}

enum MessageRole {
    @@type("pg/text@1")

    user
    assistant
}

// The practice areas the demo firm handles, plus `other`. The lead tool may only pick one of these.
enum CaseType {
    @@type("pg/text@1")

    dui
    criminal_defense
    family_law
    personal_injury
    estate_planning
    other
}

enum HandoffStatus {
    @@type("pg/text@1")

    pending
    resolved
}

enum LlmPurpose {
    @@type("pg/text@1")

    route
    answer
    lead
    embed_query
    embed_document
}
```

The case types must match the practice areas in the firm's content (Phase 10). If you change the
firm's practice areas, change this enum in the same commit.

### Step 2 — Models

```prisma
model Conversation {
    id        Uuid               @id @default(uuid())
    // The anonymous visitor cookie (Phase 08), so one browser's chats can be grouped and rate limited.
    visitorId String
    status    ConversationStatus @default(open)
    createdAt TimestamptzString  @default(now())
    updatedAt TimestamptzString  @default(now())
    messages  Message[]
    lead      Lead?
    handoff   Handoff?
    llmCalls  LlmCall[]

    @@index([visitorId])
    // The staff queue: "conversations needing a human, newest activity first".
    @@index([status, updatedAt])
}

model Message {
    id             Uuid              @id @default(uuid())
    conversationId Uuid
    role           MessageRole
    content        String
    // Set on assistant messages: what the router decided and which prompt produced the answer.
    intent         String?
    promptVersion  String?
    // Stage timings for assistant messages (Phase 20), in milliseconds.
    retrieveMs     Int?
    firstTokenMs   Int?
    totalMs        Int?
    createdAt      TimestamptzString @default(now())
    conversation   Conversation      @relation(fields: [conversationId], references: [id], onDelete: Cascade)
    citations      MessageCitation[]

    @@index([conversationId, createdAt])
}

model MessageCitation {
    id        Uuid     @id @default(uuid())
    messageId Uuid
    // Null once the section is deleted by re-ingestion; the snapshot below keeps the meaning.
    sectionId Uuid?
    // The [n] shown in the answer.
    number    Int
    url       String
    heading   String
    message   Message  @relation(fields: [messageId], references: [id], onDelete: Cascade)
    section   Section? @relation(fields: [sectionId], references: [id], onDelete: SetNull)

    @@unique([messageId, number])
    @@index([sectionId])
}

model Lead {
    id             Uuid              @id @default(uuid())
    // Unique: one lead per conversation, however many times the model calls the tool.
    conversationId Uuid              @unique
    name           String
    email          String?
    phone          String?
    caseType       CaseType
    // One or two sentences from the visitor about their situation, if they gave any.
    summary        String?
    createdAt      TimestamptzString @default(now())
    conversation   Conversation      @relation(fields: [conversationId], references: [id], onDelete: Cascade)

    @@index([createdAt])
    @@check(expression: "email IS NOT NULL OR phone IS NOT NULL", name: "lead_has_contact")
}

model Handoff {
    id             Uuid              @id @default(uuid())
    conversationId Uuid              @unique
    reason         String
    status         HandoffStatus     @default(pending)
    createdAt      TimestamptzString @default(now())
    // Null until staff resolve it.
    resolvedAt     TimestamptzString?
    conversation   Conversation      @relation(fields: [conversationId], references: [id], onDelete: Cascade)

    @@index([status, createdAt])
}

model LlmCall {
    id             Uuid              @id @default(uuid())
    // The X-Request-Id of the request that made the call (Phase 02); null for scripts and evals.
    requestId      String?
    conversationId Uuid?
    purpose        LlmPurpose
    provider       String
    model          String
    promptVersion  String?
    inputTokens    Int               @default(0)
    outputTokens   Int               @default(0)
    latencyMs      Int
    // Streaming calls only: time until the first token arrived.
    firstTokenMs   Int?
    // Estimated cost in millionths of a US dollar (Phase 20 explains the estimate).
    costMicros     Int               @default(0)
    // True when the primary provider failed and this row is the fallback's answer.
    fellBack       Boolean           @default(false)
    ok             Boolean
    errorCode      String?
    createdAt      TimestamptzString @default(now())
    conversation   Conversation?     @relation(fields: [conversationId], references: [id], onDelete: SetNull)

    @@index([createdAt])
    @@index([conversationId])
}
```

Also add the back-relation on `Section`:

```prisma
    citations      MessageCitation[]
```

### Step 3 — Plan, read, apply

```bash
cd apps/api
pnpm db:plan add_chat_tables
pnpm db:sql
```

In `migration.sql`, check:

- `CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL)` on `lead`
- unique indexes on `lead."conversationId"` and `handoff."conversationId"`
- `ON DELETE SET NULL` on `messageCitation."sectionId"` and `llmCall."conversationId"`
- `ON DELETE CASCADE` on `message`, `messageCitation."messageId"`, `lead`, `handoff`
- one generated `CHECK (… IN ('dui', 'criminal_defense', …))` per enum column

```bash
pnpm db:migrate && pnpm db:verify
```

## 7. Commit points

1. `feat(db): add conversation, message, citation, lead, handoff and llm call tables`

## 8. Verify

Prove the constraints refuse bad data — in `psql`:

```sql
INSERT INTO conversation (id, "visitorId") VALUES ('10000000-0000-0000-0000-000000000001', 'v1');

-- No contact: refused by the CHECK.
INSERT INTO lead ("conversationId", name, "caseType")
VALUES ('10000000-0000-0000-0000-000000000001', 'Ana', 'dui');
-- ERROR: new row for relation "lead" violates check constraint "lead_has_contact…"

-- Unknown case type: refused by the enum CHECK.
INSERT INTO lead ("conversationId", name, phone, "caseType")
VALUES ('10000000-0000-0000-0000-000000000001', 'Ana', '555', 'tax');
-- ERROR: … violates check constraint …

-- Valid, then a duplicate for the same conversation: refused by the unique index.
INSERT INTO lead ("conversationId", name, phone, "caseType")
VALUES ('10000000-0000-0000-0000-000000000001', 'Ana', '555', 'dui');
INSERT INTO lead ("conversationId", name, phone, "caseType")
VALUES ('10000000-0000-0000-0000-000000000001', 'Ana', '555', 'dui');
-- ERROR: duplicate key value violates unique constraint …   (SQLSTATE 23505)

-- Cascade: deleting the conversation removes the lead.
DELETE FROM conversation WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT count(*) FROM lead;   -- 0
```

Note the SQLSTATE `23505`: Phase 18 catches exactly that code to make a repeated `createLead` call
harmless (the port's `catalog.service.ts` checks the same code).

## 9. Common mistakes

- **Making `lead.conversationId` non-unique "for flexibility".** Then a retried tool call creates two
  leads and staff call the visitor twice.
- **Cascade on citations' `sectionId`.** Re-ingesting the site would silently delete history from
  past answers.
- **Storing cost as a float.** Sums drift (`0.1 + 0.2 ≠ 0.3`). Integers of a small unit don't.
- **An enum value in code that isn't in the contract.** The insert fails at runtime with a CHECK
  violation; keep the `CaseType` Zod enum (Phase 18) generated from the same list.

## 10. Interview prep

**Q: How do you guarantee one lead per conversation even with retries?**
A: A unique index on `lead.conversationId`. The database rejects the second insert with a unique
violation, which the service catches and treats as "already captured". No locking, no race window.

**Q: Why store citations in their own table?**
A: So I can query them: which sections get cited, whether an answer cited the expected section in
the eval suite. Each row also snapshots the URL and heading, so old transcripts stay readable after
the content changes.

**Q: What do you log about each LLM call and why?**
A: Provider, model, prompt version, input/output tokens, latency, time to first token, estimated
cost, whether it fell back, and errors. It's the raw material for cost and latency reporting, for
comparing prompt versions, and for spotting a flaky provider.

## 11. Resume-safe claim

"Modelled conversations, leads, human handoffs and per-call LLM telemetry in Postgres, enforcing
business rules (contact required, one lead per conversation) as database constraints."

## 12. Definition of done

- [ ] All six tables and five enums exist; `pnpm db:verify` clean
- [ ] The four constraint experiments fail or succeed exactly as described
- [ ] I can say for each foreign key why it's Cascade, SetNull or Restrict
- [ ] Typecheck passes with the re-emitted contract types
