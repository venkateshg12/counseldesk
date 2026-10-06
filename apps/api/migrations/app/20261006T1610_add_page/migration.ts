#!/usr/bin/env -S node
import type { Contract as End } from "../../snapshots/8d16c2ec2abe44814677807784b03c6a4e3fbcec51e7133d6e701c0d5f6db2dd/contract";
import endContract from "../../snapshots/8d16c2ec2abe44814677807784b03c6a4e3fbcec51e7133d6e701c0d5f6db2dd/contract.json" with { type: "json" };
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  primaryKey,
} from "@prisma/orm-postgres/migration";

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: "public" }),
      this.createTable({
        schema: "public",
        table: "Page",
        columns: [
          col("contentHash", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
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
          col("path", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("title", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("updatedAt", "timestamptz", {
            notNull: true,
            default: fn("now()"),
            codecRef: { codecId: "pg/timestamptz-string@1" },
          }),
        ],
        constraints: [primaryKey(["id"])],
      }),
      this.addUnique({
        schema: "public",
        table: "Page",
        constraint: "Page_path_key",
        columns: ["path"],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
