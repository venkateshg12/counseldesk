// How many candidates each search returns before merging (Phase 13).
export const SEARCH_CANDIDATES = 20;

// Reciprocal Rank Fusion constant (original paper's value). Larger = agreement matters more than rank.
export const RRF_K = 60;

// Sections given to the model as sources.
export const CONTEXT_SECTIONS = 5;

export const SEARCH_MODES = ["hybrid", "keyword", "vector"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];
