#!/usr/bin/env -S node
import type { Contract as End } from "../../snapshots/3f719410c74b63567e2a1f40a0200a5e69c44f81aeb3dc43cefe91df4ec14612/contract";
import endContract from "../../snapshots/3f719410c74b63567e2a1f40a0200a5e69c44f81aeb3dc43cefe91df4ec14612/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/b77779e7a682e279868da330251ae9c1cbd945b406339e44f30695127ba71d9a/contract";
import startContract from "../../snapshots/b77779e7a682e279868da330251ae9c1cbd945b406339e44f30695127ba71d9a/contract.json" with { type: "json" };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
} from "@prisma/orm-postgres/migration";

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: "public",
        table: "Conversation",
        columns: [
          col("createdAt", "timestamptz", {
            notNull: true,
            default: fn("now()"),
            codecRef: { codecId: "pg/timestamptz-string@1" },
          }),
          col("id", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
          col("status", "text", {
            notNull: true,
            default: lit("open"),
            codecRef: { codecId: "pg/text@1" },
          }),
          col("updatedAt", "timestamptz", {
            notNull: true,
            default: fn("now()"),
            codecRef: { codecId: "pg/timestamptz-string@1" },
          }),
          col("visitorId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"]),
          checkExpression(
            "Conversation_status_check_b3ad3e52",
            "\"status\" IN ('open', 'needs_human', 'closed')",
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "Handoff",
        columns: [
          col("conversationId", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
          col("createdAt", "timestamptz", {
            notNull: true,
            default: fn("now()"),
            codecRef: { codecId: "pg/timestamptz-string@1" },
          }),
          col("id", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
          col("reason", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("resolvedAt", "timestamptz", {
            codecRef: { codecId: "pg/timestamptz-string@1" },
          }),
          col("status", "text", {
            notNull: true,
            default: lit("pending"),
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"]),
          checkExpression(
            "Handoff_status_check_dd46f51e",
            "\"status\" IN ('pending', 'resolved')",
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "Lead",
        columns: [
          col("caseType", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("conversationId", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
          col("createdAt", "timestamptz", {
            notNull: true,
            default: fn("now()"),
            codecRef: { codecId: "pg/timestamptz-string@1" },
          }),
          col("email", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("id", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
          col("name", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("phone", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("summary", "text", { codecRef: { codecId: "pg/text@1" } }),
        ],
        constraints: [
          primaryKey(["id"]),
          checkExpression(
            "Lead_caseType_check_a2235d1b",
            "\"caseType\" IN ('dui', 'criminal_defense', 'family_law', 'personal_injury', 'estate_planning', 'other')",
          ),
          checkExpression(
            "lead_has_contact_00f19457",
            "email IS NOT NULL OR phone IS NOT NULL",
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "LlmCall",
        columns: [
          col("conversationId", "uuid", { codecRef: { codecId: "pg/uuid@1" } }),
          col("costMicros", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("createdAt", "timestamptz", {
            notNull: true,
            default: fn("now()"),
            codecRef: { codecId: "pg/timestamptz-string@1" },
          }),
          col("errorCode", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("fellBack", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("firstTokenMs", "int4", { codecRef: { codecId: "pg/int4@1" } }),
          col("id", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
          col("inputTokens", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("latencyMs", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("model", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("ok", "bool", {
            notNull: true,
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("outputTokens", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("promptVersion", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("provider", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("purpose", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("requestId", "text", { codecRef: { codecId: "pg/text@1" } }),
        ],
        constraints: [
          primaryKey(["id"]),
          checkExpression(
            "LlmCall_purpose_check_566d3aac",
            "\"purpose\" IN ('route', 'answer', 'lead', 'embed_query', 'embed_document')",
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "Message",
        columns: [
          col("content", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("conversationId", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
          col("createdAt", "timestamptz", {
            notNull: true,
            default: fn("now()"),
            codecRef: { codecId: "pg/timestamptz-string@1" },
          }),
          col("firstTokenMs", "int4", { codecRef: { codecId: "pg/int4@1" } }),
          col("id", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
          col("intent", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("promptVersion", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("retrieveMs", "int4", { codecRef: { codecId: "pg/int4@1" } }),
          col("role", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("totalMs", "int4", { codecRef: { codecId: "pg/int4@1" } }),
        ],
        constraints: [
          primaryKey(["id"]),
          checkExpression(
            "Message_role_check_207dfd80",
            "\"role\" IN ('user', 'assistant')",
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "MessageCitation",
        columns: [
          col("heading", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("id", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
          col("messageId", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
          col("number", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("sectionId", "uuid", { codecRef: { codecId: "pg/uuid@1" } }),
          col("url", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"])],
      }),
      this.addUnique({
        schema: "public",
        table: "Handoff",
        constraint: "Handoff_conversationId_key",
        columns: ["conversationId"],
      }),
      this.addUnique({
        schema: "public",
        table: "Lead",
        constraint: "Lead_conversationId_key",
        columns: ["conversationId"],
      }),
      this.addUnique({
        schema: "public",
        table: "MessageCitation",
        constraint: "MessageCitation_messageId_number_key",
        columns: ["messageId", "number"],
      }),
      this.createIndex({
        schema: "public",
        table: "Conversation",
        index: "Conversation_status_updatedAt_idx_29f913bb",
        columns: ["status", "updatedAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "Conversation",
        index: "Conversation_visitorId_idx_9d3ff46a",
        columns: ["visitorId"],
      }),
      this.createIndex({
        schema: "public",
        table: "Handoff",
        index: "Handoff_status_createdAt_idx_58610442",
        columns: ["status", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "Lead",
        index: "Lead_createdAt_idx_9575dbd7",
        columns: ["createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "LlmCall",
        index: "LlmCall_conversationId_idx_669215a6",
        columns: ["conversationId"],
      }),
      this.createIndex({
        schema: "public",
        table: "LlmCall",
        index: "LlmCall_createdAt_idx_9575dbd7",
        columns: ["createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "Message",
        index: "Message_conversationId_createdAt_idx_44d4ac61",
        columns: ["conversationId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "Message",
        index: "Message_conversationId_idx_669215a6",
        columns: ["conversationId"],
      }),
      this.createIndex({
        schema: "public",
        table: "MessageCitation",
        index: "MessageCitation_messageId_idx_3cdded8d",
        columns: ["messageId"],
      }),
      this.createIndex({
        schema: "public",
        table: "MessageCitation",
        index: "MessageCitation_sectionId_idx_5d1ea56b",
        columns: ["sectionId"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "Handoff",
        foreignKey: {
          name: "Handoff_conversationId_fkey",
          columns: ["conversationId"],
          references: {
            schema: "public",
            table: "Conversation",
            columns: ["id"],
          },
          onDelete: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "Lead",
        foreignKey: {
          name: "Lead_conversationId_fkey",
          columns: ["conversationId"],
          references: {
            schema: "public",
            table: "Conversation",
            columns: ["id"],
          },
          onDelete: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "LlmCall",
        foreignKey: {
          name: "LlmCall_conversationId_fkey",
          columns: ["conversationId"],
          references: {
            schema: "public",
            table: "Conversation",
            columns: ["id"],
          },
          onDelete: "setNull",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "Message",
        foreignKey: {
          name: "Message_conversationId_fkey",
          columns: ["conversationId"],
          references: {
            schema: "public",
            table: "Conversation",
            columns: ["id"],
          },
          onDelete: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "MessageCitation",
        foreignKey: {
          name: "MessageCitation_messageId_fkey",
          columns: ["messageId"],
          references: { schema: "public", table: "Message", columns: ["id"] },
          onDelete: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "MessageCitation",
        foreignKey: {
          name: "MessageCitation_sectionId_fkey",
          columns: ["sectionId"],
          references: { schema: "public", table: "Section", columns: ["id"] },
          onDelete: "setNull",
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
