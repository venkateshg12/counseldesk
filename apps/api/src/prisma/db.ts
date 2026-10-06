import pg from "pg";
import postgres from "@prisma/orm-postgres/runtime";
import pgvector from "@prisma/orm-extension-pgvector/runtime";
import type { Contract } from "./contract.js";
import contractJson from "./contract.json" with { type: "json" };
import { DATABASE_URL } from "../constants/env.js";

// One pool shared by the ORM and by hand-written SQL (health check, search).
export const pool = new pg.Pool({ connectionString: DATABASE_URL });

export const db = postgres<Contract>({
  contractJson,
  pg: pool,
  extensions: [pgvector],
});

// Every model lives in the `public` schema, so callers write `orm.Page` instead of
// `db.orm.public.Page`.
export const orm = db.orm.public;
