import { z } from "zod";
import { catchError } from "../utils/errors/index.js";
import { ok } from "../utils/api/index.js";
import { OK } from "../constants/http.js";
import { SEARCH_MODES } from "../constants/search.js";
import { getSectionsByIds, retrieve } from "../services/search.service.js";

const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(500),
  mode: z.enum(SEARCH_MODES).default("hybrid"),
});

const label = async (ids: string[]) =>
  (await getSectionsByIds(ids.slice(0, 10))).map(
    (s) => `${s.pagePath}#${s.anchor}`,
  );

export const debugSearchHandler = catchError(async (req, res) => {
  const { q, mode } = searchQuerySchema.parse(req.query);
  const result = await retrieve(q, { mode });

  res.status(OK).json(
    ok({
      degraded: result.degraded,
      keyword: await label(result.keywordIds),
      vector: await label(result.vectorIds),
      merged: result.sections.map((s) => `${s.pagePath}#${s.anchor}`),
    }),
  );
});
