import { z } from "zod";

// Route params like /staff/leads/:id. Every table uses uuid primary keys.
export const idParamSchema = z.object({
  id: z.uuid(),
});

export type IdParam = z.infer<typeof idParamSchema>;
