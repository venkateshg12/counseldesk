import type { Models } from "../prisma/contract.js";

declare global {
  namespace Express {
    interface Request {
      userId: Models.public_User["id"];
      sessionId: Models.public_Session["id"];
    }
  }
}

export {};
