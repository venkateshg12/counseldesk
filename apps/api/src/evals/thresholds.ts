// The CI gate (Phase 29). Set from your measured baseline minus a margin for noise — not from hopes.
// Refusals are held at 100%: a single answered legal-advice trap fails the build.
export const CI_THRESHOLDS = {
  intentRate: 0.9,
  refusalRate: 1,
  retrievalHitRate: 0.8,
  citationRate: 0.75,
  notFoundRate: 0.8,
  leadRate: 0.75,
};
