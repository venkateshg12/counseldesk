#!/usr/bin/env -S node
import type { Contract as Start } from "../../snapshots/3f719410c74b63567e2a1f40a0200a5e69c44f81aeb3dc43cefe91df4ec14612/contract";
import startContract from "../../snapshots/3f719410c74b63567e2a1f40a0200a5e69c44f81aeb3dc43cefe91df4ec14612/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/8fae9ea2ae5040891a889a97e79335004b5672c6a6536d831e5abfbccbae7c9a/contract";
import endContract from "../../snapshots/8fae9ea2ae5040891a889a97e79335004b5672c6a6536d831e5abfbccbae7c9a/contract.json" with { type: "json" };
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  primaryKey,
} from "@prisma/orm-postgres/migration";

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: "public",
        table: "Session",
        columns: [
          col("createdAt", "timestamptz", {
            notNull: true,
            default: fn("now()"),
            codecRef: { codecId: "pg/timestamptz-string@1" },
          }),
          col("expiresAt", "timestamptz", {
            notNull: true,
            default: fn("(CURRENT_TIMESTAMP + '30 days'::interval)"),
            codecRef: { codecId: "pg/timestamptz-string@1" },
          }),
          col("id", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
          col("prevRefreshJti", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("refreshJti", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("rotatedAt", "timestamptz", {
            codecRef: { codecId: "pg/timestamptz-string@1" },
          }),
          col("userAgent", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("userId", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
        ],
        constraints: [primaryKey(["id"])],
      }),
      this.createTable({
        schema: "public",
        table: "User",
        columns: [
          col("createdAt", "timestamptz", {
            notNull: true,
            default: fn("now()"),
            codecRef: { codecId: "pg/timestamptz-string@1" },
          }),
          col("email", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("id", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
          col("name", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("passwordHash", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"])],
      }),
      this.addUnique({
        schema: "public",
        table: "User",
        constraint: "User_email_key",
        columns: ["email"],
      }),
      this.createIndex({
        schema: "public",
        table: "Session",
        index: "Session_expiresAt_idx_6b6b8c10",
        columns: ["expiresAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "Session",
        index: "Session_userId_idx_a489d58a",
        columns: ["userId"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "Session",
        foreignKey: {
          name: "Session_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "User", columns: ["id"] },
          onDelete: "cascade",
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
