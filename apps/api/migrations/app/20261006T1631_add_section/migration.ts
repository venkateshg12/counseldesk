#!/usr/bin/env -S node
import type { Contract as Start } from "../../snapshots/8d16c2ec2abe44814677807784b03c6a4e3fbcec51e7133d6e701c0d5f6db2dd/contract";
import startContract from "../../snapshots/8d16c2ec2abe44814677807784b03c6a4e3fbcec51e7133d6e701c0d5f6db2dd/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/b77779e7a682e279868da330251ae9c1cbd945b406339e44f30695127ba71d9a/contract";
import endContract from "../../snapshots/b77779e7a682e279868da330251ae9c1cbd945b406339e44f30695127ba71d9a/contract.json" with { type: "json" };
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
        table: "Section",
        columns: [
          col("anchor", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("content", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("contentHash", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("createdAt", "timestamptz", {
            notNull: true,
            default: fn("now()"),
            codecRef: { codecId: "pg/timestamptz-string@1" },
          }),
          col("embedding", "vector(768)", {
            notNull: true,
            codecRef: { codecId: "pg/vector@1", typeParams: { length: 768 } },
          }),
          col("embeddingModel", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("heading", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("id", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
          col("pageId", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
          col("position", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("searchText", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"])],
      }),
      this.addUnique({
        schema: "public",
        table: "Section",
        constraint: "Section_pageId_anchor_key",
        columns: ["pageId", "anchor"],
      }),
      this.createIndex({
        schema: "public",
        table: "Section",
        index: "Section_pageId_idx_8caaba4f",
        columns: ["pageId"],
      }),
      this.createIndex({
        schema: "public",
        table: "Section",
        index: "section_search_text_1c7a2572",
        expression: "to_tsvector('english', \"searchText\")",
        extras: { type: "gin" },
      }),
      this.addForeignKey({
        schema: "public",
        table: "Section",
        foreignKey: {
          name: "Section_pageId_fkey",
          columns: ["pageId"],
          references: { schema: "public", table: "Page", columns: ["id"] },
          onDelete: "cascade",
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
