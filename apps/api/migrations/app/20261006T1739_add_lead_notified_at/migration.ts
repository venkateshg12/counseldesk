#!/usr/bin/env -S node
import type { Contract as Start } from "../../snapshots/8fae9ea2ae5040891a889a97e79335004b5672c6a6536d831e5abfbccbae7c9a/contract";
import startContract from "../../snapshots/8fae9ea2ae5040891a889a97e79335004b5672c6a6536d831e5abfbccbae7c9a/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/98d553d811777c7f0316448a1c1bf866207185e3b5d2028586fae5021ad9c9ad/contract";
import endContract from "../../snapshots/98d553d811777c7f0316448a1c1bf866207185e3b5d2028586fae5021ad9c9ad/contract.json" with { type: "json" };
import { Migration, MigrationCLI, col } from "@prisma/orm-postgres/migration";

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: "public",
        table: "Lead",
        column: col("notifiedAt", "timestamptz", {
          codecRef: { codecId: "pg/timestamptz-string@1" },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
