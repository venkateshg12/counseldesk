import { z } from "zod";
import { paginationQuerySchema } from "./common.js";

export const handoffListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["pending", "resolved"]).default("pending"),
});

export type HandoffListQuery = z.infer<typeof handoffListQuerySchema>;
