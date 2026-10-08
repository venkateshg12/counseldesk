#!/usr/bin/env -S node
import type { Contract as End } from "../../snapshots/7bef5be1b39b4212be3f59f7f0dd795a3fc2f3e76ec654d7f6b599afec690358/contract";
import endContract from "../../snapshots/7bef5be1b39b4212be3f59f7f0dd795a3fc2f3e76ec654d7f6b599afec690358/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/98d553d811777c7f0316448a1c1bf866207185e3b5d2028586fae5021ad9c9ad/contract";
import startContract from "../../snapshots/98d553d811777c7f0316448a1c1bf866207185e3b5d2028586fae5021ad9c9ad/contract.json" with { type: "json" };
import {
  Migration,
  MigrationCLI,
  placeholder,
} from "@prisma/orm-postgres/migration";

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.alterColumnType({
        schema: "public",
        table: "Section",
        column: "embedding",
        options: {
          qualifiedTargetType: "vector(2048)",
          formatTypeExpected: "vector(2048)",
          rawTargetTypeForLabel: "vector(2048)",
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
