import { pool } from "../prisma/db.js";
import { KEYWORD_QUERY, NVIDIA_EMBEDDING_MODEL } from "../constants/env.js";
import {
  CONTEXT_SECTIONS,
  RRF_K,
  SEARCH_CANDIDATES,
  type SearchMode,
} from "../constants/search.js";
import { embedQuery } from "../ai/embeddings.js";
import { reciprocalRankFusion } from "../utils/rrf.js";
import { logger } from "../utils/logger.js";

export type RankedId = { id: string; score: number };

// OR of the question's stems (default), or websearch_to_tsquery's AND of every word.
const QUERY_EXPRESSION =
  KEYWORD_QUERY === "and"
    ? `websearch_to_tsquery('english', $1)`
    : `(SELECT to_tsquery('simple', string_agg(quote_literal(lexeme), ' | ')) FROM unnest(tsvector_to_array(to_tsvector('english', $1))) AS lexeme)`;

const KEYWORD_SQL = `
  WITH q AS (SELECT ${QUERY_EXPRESSION} AS query)
  SELECT s.id, ts_rank_cd(to_tsvector('english', s."searchText"), q.query) AS score
  FROM "Section" s, q
  WHERE q.query IS NOT NULL
    AND to_tsvector('english', s."searchText") @@ q.query
  ORDER BY score DESC, s.id
  LIMIT $2
`;

export const keywordSearch = async (
  question: string,
  limit = SEARCH_CANDIDATES,
): Promise<RankedId[]> => {
  const { rows } = await pool.query<{ id: string; score: number }>(
    KEYWORD_SQL,
    [question, limit],
  );
  return rows;
};

// Cosine distance: 0 = same direction. Score is reported as similarity (1 - distance) so higher is
// better in both searches.
const VECTOR_SQL = `
  SELECT id, 1 - (embedding <=> $1::vector) AS score
  FROM "Section"
  WHERE "embeddingModel" = $2
  ORDER BY embedding <=> $1::vector, id
  LIMIT $3
`;

export const vectorSearch = async (
  queryVector: number[],
  limit = SEARCH_CANDIDATES,
): Promise<RankedId[]> => {
  const { rows } = await pool.query<{ id: string; score: number }>(VECTOR_SQL, [
    JSON.stringify(queryVector),
    NVIDIA_EMBEDDING_MODEL,
    limit,
  ]);
  return rows;
};

export type SectionHit = {
  id: string;
  anchor: string;
  heading: string;
  content: string;
  pagePath: string;
  pageTitle: string;
};

// Full rows for a list of ids, returned in the same order as the ids (SQL IN doesn't keep order).
export const getSectionsByIds = async (
  ids: string[],
): Promise<SectionHit[]> => {
  if (ids.length === 0) return [];
  const { rows } = await pool.query<SectionHit>(
    `SELECT s.id, s.anchor, s.heading, s.content, p.path AS "pagePath", p.title AS "pageTitle"
     FROM "Section" s JOIN "Page" p ON p.id = s."pageId"
     WHERE s.id = ANY($1::uuid[])`,
    [ids],
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is SectionHit => row !== undefined);
};

export type Retrieval = {
  sections: SectionHit[];
  keywordIds: string[];
  vectorIds: string[];
  // True when vector search was wanted but the embedding call failed.
  degraded: boolean;
};

export const retrieve = async (
  question: string,
  { mode = "hybrid" as SearchMode, limit = CONTEXT_SECTIONS } = {},
): Promise<Retrieval> => {
  const wantKeyword = mode !== "vector";
  const wantVector = mode !== "keyword";

  const keywordPromise = wantKeyword
    ? keywordSearch(question)
    : Promise.resolve([]);
  const vectorPromise = wantVector
    ? embedQuery(question)
        .then((vector) => vectorSearch(vector))
        .catch((error: unknown) => {
          logger.warn("vector search unavailable, using keyword results only", {
            error,
          });
          return null;
        })
    : Promise.resolve([]);

  const [keyword, vector] = await Promise.all([keywordPromise, vectorPromise]);

  const keywordIds = keyword.map((r) => r.id);
  const vectorIds = (vector ?? []).map((r) => r.id);
  const fusedIds = reciprocalRankFusion([keywordIds, vectorIds], RRF_K).map(
    (f) => f.id,
  );

  return {
    sections: await getSectionsByIds(fusedIds.slice(0, limit)),
    keywordIds,
    vectorIds,
    degraded: wantVector && vector === null,
  };
};
