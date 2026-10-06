import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamily } from "node:net";
import { db, pool } from "../prisma/db.js";
import { logger } from "../utils/logger.js";

// Node races IPv4 and IPv6 for every new connection. Where there is no real IPv6 route (WSL2,
// some containers) the IPv6 attempts lose silently and connections time out intermittently.
setDefaultResultOrder("ipv4first");
setDefaultAutoSelectFamily(false);

export const connectDB = async () => {
  await db.connect();
  // db.connect() binds the runtime; this proves a real connection can be made right now.
  await pool.query("SELECT 1");
  logger.info("connected to postgres");
};

export const closeDB = async () => {
  await db.close();
  // We created the pool, so we end it. db.close() leaves caller-owned pools open.
  await pool.end();
};

export { db, pool };
