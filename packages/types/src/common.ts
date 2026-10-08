import { z } from "zod";

// Route params like /staff/leads/:id. Every table uses uuid primary keys.
export const idParamSchema = z.object({
  id: z.uuid(),
});

export type IdParam = z.infer<typeof idParamSchema>;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};
