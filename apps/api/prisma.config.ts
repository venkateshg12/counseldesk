import "dotenv/config";
import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamily } from "node:net";
import { definePrismaConfig } from "@prisma/cli-engine";
import { defineConfig as ormConfig } from "@prisma/orm-postgres/config";
import pgvector from "@prisma/orm-extension-pgvector/control";

// The Prisma CLI loads this file but not src/config/db.ts, so apply the same IPv4 pin here.
// Without it, WSL2 (no IPv6 route) times out connecting to Neon (Phase 30).
setDefaultResultOrder("ipv4first");
setDefaultAutoSelectFamily(false);

export default definePrismaConfig({
  orm: ormConfig({
    contract: "./src/prisma/contract.prisma",
    extensions: [pgvector],
    db: {
      connection: process.env["DATABASE_URL"]!,
    },
  }),
});
