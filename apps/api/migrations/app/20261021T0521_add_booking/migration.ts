#!/usr/bin/env -S node
import type { Contract as End } from "../../snapshots/3d4283d3aae1e46bdb283e859bac488331eb4989ed2245c8a5a56ba25fc6b7fe/contract";
import endContract from "../../snapshots/3d4283d3aae1e46bdb283e859bac488331eb4989ed2245c8a5a56ba25fc6b7fe/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/54754972a75a896c85194c0a7a4788c5d680816c6b24fb61d7831c628d88e988/contract";
import startContract from "../../snapshots/54754972a75a896c85194c0a7a4788c5d680816c6b24fb61d7831c628d88e988/contract.json" with { type: "json" };
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
        table: "Appointment",
        columns: [
          col("attorneyId", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
          col("cancelledAt", "timestamptz", {
            codecRef: { codecId: "pg/timestamptz-string@1" },
          }),
          col("caseType", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("confirmedAt", "timestamptz", {
            codecRef: { codecId: "pg/timestamptz-string@1" },
          }),
          col("conversationId", "uuid", { codecRef: { codecId: "pg/uuid@1" } }),
          col("createdAt", "timestamptz", {
            notNull: true,
            default: fn("now()"),
            codecRef: { codecId: "pg/timestamptz-string@1" },
          }),
          col("email", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("endsAt", "timestamptz", {
            notNull: true,
            codecRef: { codecId: "pg/timestamptz-string@1" },
          }),
          col("id", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
          col("leadId", "uuid", { codecRef: { codecId: "pg/uuid@1" } }),
          col("linkVersion", "int4", {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("mode", "text", {
            notNull: true,
            default: lit("video"),
            codecRef: { codecId: "pg/text@1" },
          }),
          col("name", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("phone", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("slotKey", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("startsAt", "timestamptz", {
            notNull: true,
            codecRef: { codecId: "pg/timestamptz-string@1" },
          }),
          col("status", "text", {
            notNull: true,
            default: lit("booked"),
            codecRef: { codecId: "pg/text@1" },
          }),
          col("summary", "text", { codecRef: { codecId: "pg/text@1" } }),
        ],
        constraints: [
          primaryKey(["id"]),
          checkExpression(
            "Appointment_caseType_check_a2235d1b",
            "\"caseType\" IN ('dui', 'criminal_defense', 'family_law', 'personal_injury', 'estate_planning', 'other')",
          ),
          checkExpression(
            "Appointment_mode_check_7b158617",
            "\"mode\" IN ('video', 'in_person')",
          ),
          checkExpression(
            "Appointment_status_check_e31768d9",
            "\"status\" IN ('booked', 'cancelled', 'completed', 'no_show')",
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "Attorney",
        columns: [
          col("active", "bool", {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: "pg/bool@1" },
          }),
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
          col("slug", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"])],
      }),
      this.createTable({
        schema: "public",
        table: "AttorneyPracticeArea",
        columns: [
          col("attorneyId", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
          col("caseType", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("id", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"]),
          checkExpression(
            "AttorneyPracticeArea_caseType_check_a2235d1b",
            "\"caseType\" IN ('dui', 'criminal_defense', 'family_law', 'personal_injury', 'estate_planning', 'other')",
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "AvailabilityRule",
        columns: [
          col("attorneyId", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
          col("endMinute", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("id", "uuid", {
            notNull: true,
            codecRef: { codecId: "pg/uuid@1" },
          }),
          col("startMinute", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("weekday", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"]),
          checkExpression(
            "availability_weekday_bb77959a",
            "weekday BETWEEN 0 AND 6",
          ),
        ],
      }),
      this.addColumn({
        schema: "public",
        table: "Lead",
        column: col("assignedAttorneyId", "uuid", {
          codecRef: { codecId: "pg/uuid@1" },
        }),
      }),
      this.addUnique({
        schema: "public",
        table: "Appointment",
        constraint: "Appointment_slotKey_key",
        columns: ["slotKey"],
      }),
      this.addUnique({
        schema: "public",
        table: "Attorney",
        constraint: "Attorney_slug_key",
        columns: ["slug"],
      }),
      this.addUnique({
        schema: "public",
        table: "AttorneyPracticeArea",
        constraint: "AttorneyPracticeArea_attorneyId_caseType_key",
        columns: ["attorneyId", "caseType"],
      }),
      this.createIndex({
        schema: "public",
        table: "Appointment",
        index: "Appointment_attorneyId_idx_f73d9f49",
        columns: ["attorneyId"],
      }),
      this.createIndex({
        schema: "public",
        table: "Appointment",
        index: "Appointment_attorneyId_startsAt_idx_8c07b5bd",
        columns: ["attorneyId", "startsAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "Appointment",
        index: "Appointment_conversationId_idx_669215a6",
        columns: ["conversationId"],
      }),
      this.createIndex({
        schema: "public",
        table: "Appointment",
        index: "Appointment_leadId_idx_9113844c",
        columns: ["leadId"],
      }),
      this.createIndex({
        schema: "public",
        table: "Appointment",
        index: "Appointment_status_startsAt_idx_b8c24256",
        columns: ["status", "startsAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "AttorneyPracticeArea",
        index: "AttorneyPracticeArea_attorneyId_idx_f73d9f49",
        columns: ["attorneyId"],
      }),
      this.createIndex({
        schema: "public",
        table: "AttorneyPracticeArea",
        index: "AttorneyPracticeArea_caseType_idx_d44eddf2",
        columns: ["caseType"],
      }),
      this.createIndex({
        schema: "public",
        table: "AvailabilityRule",
        index: "AvailabilityRule_attorneyId_idx_f73d9f49",
        columns: ["attorneyId"],
      }),
      this.createIndex({
        schema: "public",
        table: "Lead",
        index: "Lead_assignedAttorneyId_idx_b9e8d3da",
        columns: ["assignedAttorneyId"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "Appointment",
        foreignKey: {
          name: "Appointment_attorneyId_fkey",
          columns: ["attorneyId"],
          references: { schema: "public", table: "Attorney", columns: ["id"] },
          onDelete: "restrict",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "Appointment",
        foreignKey: {
          name: "Appointment_leadId_fkey",
          columns: ["leadId"],
          references: { schema: "public", table: "Lead", columns: ["id"] },
          onDelete: "setNull",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "Appointment",
        foreignKey: {
          name: "Appointment_conversationId_fkey",
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
        table: "AttorneyPracticeArea",
        foreignKey: {
          name: "AttorneyPracticeArea_attorneyId_fkey",
          columns: ["attorneyId"],
          references: { schema: "public", table: "Attorney", columns: ["id"] },
          onDelete: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "AvailabilityRule",
        foreignKey: {
          name: "AvailabilityRule_attorneyId_fkey",
          columns: ["attorneyId"],
          references: { schema: "public", table: "Attorney", columns: ["id"] },
          onDelete: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "Lead",
        foreignKey: {
          name: "Lead_assignedAttorneyId_fkey",
          columns: ["assignedAttorneyId"],
          references: { schema: "public", table: "Attorney", columns: ["id"] },
          onDelete: "setNull",
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
