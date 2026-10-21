#!/usr/bin/env -S node
import type { Contract as End } from "../../snapshots/54754972a75a896c85194c0a7a4788c5d680816c6b24fb61d7831c628d88e988/contract";
import endContract from "../../snapshots/54754972a75a896c85194c0a7a4788c5d680816c6b24fb61d7831c628d88e988/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/7bef5be1b39b4212be3f59f7f0dd795a3fc2f3e76ec654d7f6b599afec690358/contract";
import startContract from "../../snapshots/7bef5be1b39b4212be3f59f7f0dd795a3fc2f3e76ec654d7f6b599afec690358/contract.json" with { type: "json" };
import {
  Migration,
  MigrationCLI,
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
        table: "EvalResult",
        columns: [
          col("answer", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("caseId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("category", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("citationOk", "bool", { codecRef: { codecId: "pg/bool@1" } }),
          col("costMicros", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("error", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("factsOk", "bool", { codecRef: { codecId: "pg/bool@1" } }),
          col("firstTokenMs", "int4", { codecRef: { codecId: "pg/int4@1" } }),
          col("id", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
          col("intent", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("intentOk", "bool", {
            notNull: true,
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("invalidCitations", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("leadOk", "bool", { codecRef: { codecId: "pg/bool@1" } }),
          col("notFoundOk", "bool", { codecRef: { codecId: "pg/bool@1" } }),
          col("passed", "bool", {
            notNull: true,
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("reciprocalRank", "float8", {
            codecRef: { codecId: "pg/float8@1" },
          }),
          col("retrievalHit", "bool", { codecRef: { codecId: "pg/bool@1" } }),
          col("runId", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
          col("tokens", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("totalMs", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
        ],
        constraints: [primaryKey(["id"])],
      }),
      this.createTable({
        schema: "public",
        table: "EvalRun",
        columns: [
          col("answerPromptVersion", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("avgTokensPerCase", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("cases", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("chatModel", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("citationRate", "float8", {
            codecRef: { codecId: "pg/float8@1" },
          }),
          col("costMicros", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("createdAt", "timestamptz", {
            notNull: true,
            default: fn("now()"),
            codecRef: { codecId: "pg/timestamptz-string@1" },
          }),
          col("factRate", "float8", { codecRef: { codecId: "pg/float8@1" } }),
          col("firstTokenP50", "int4", { codecRef: { codecId: "pg/int4@1" } }),
          col("firstTokenP95", "int4", { codecRef: { codecId: "pg/int4@1" } }),
          col("id", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
          col("intentRate", "float8", {
            notNull: true,
            codecRef: { codecId: "pg/float8@1" },
          }),
          col("label", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("leadRate", "float8", { codecRef: { codecId: "pg/float8@1" } }),
          col("mrr", "float8", { codecRef: { codecId: "pg/float8@1" } }),
          col("notFoundRate", "float8", {
            codecRef: { codecId: "pg/float8@1" },
          }),
          col("passRate", "float8", {
            notNull: true,
            codecRef: { codecId: "pg/float8@1" },
          }),
          col("refusalRate", "float8", {
            codecRef: { codecId: "pg/float8@1" },
          }),
          col("retrievalHitRate", "float8", {
            codecRef: { codecId: "pg/float8@1" },
          }),
          col("searchMode", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("splitDepth", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("subset", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"])],
      }),
      this.addColumn({
        schema: "public",
        table: "Handoff",
        column: col("resolvedById", "uuid", {
          codecRef: { codecId: "pg/uuid@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "Message",
        column: col("requestId", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "Message",
        column: col("routeMs", "int4", { codecRef: { codecId: "pg/int4@1" } }),
      }),
      this.createIndex({
        schema: "public",
        table: "EvalResult",
        index: "EvalResult_runId_idx_a6016437",
        columns: ["runId"],
      }),
      this.createIndex({
        schema: "public",
        table: "Handoff",
        index: "Handoff_resolvedById_idx_fc75edc7",
        columns: ["resolvedById"],
      }),
      this.createIndex({
        schema: "public",
        table: "LlmCall",
        index: "LlmCall_requestId_idx_fd667f92",
        columns: ["requestId"],
      }),
      this.createIndex({
        schema: "public",
        table: "Message",
        index: "Message_requestId_idx_fd667f92",
        columns: ["requestId"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "EvalResult",
        foreignKey: {
          name: "EvalResult_runId_fkey",
          columns: ["runId"],
          references: { schema: "public", table: "EvalRun", columns: ["id"] },
          onDelete: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "Handoff",
        foreignKey: {
          name: "Handoff_resolvedById_fkey",
          columns: ["resolvedById"],
          references: { schema: "public", table: "User", columns: ["id"] },
          onDelete: "setNull",
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
