import { isNotFoundReply } from "../utils/citations.js";
import type { EvalCase } from "./schema.js";

// "http://localhost:3000/fees#dui-fees" → "/fees#dui-fees"
export const toRef = (url: string) => {
  const { pathname, hash } = new URL(url);
  return `${pathname}${hash}`;
};

export const reciprocalRank = (retrieved: string[], expected: string[]) => {
  const index = retrieved.findIndex((ref) => expected.includes(ref));
  return index === -1 ? 0 : 1 / (index + 1);
};

export const containsAll = (text: string, needles: string[]) =>
  needles.every((needle) => text.toLowerCase().includes(needle.toLowerCase()));

export const containsNone = (text: string, needles: string[]) =>
  needles.every((needle) => !text.toLowerCase().includes(needle.toLowerCase()));

const digits = (value: string | null | undefined) =>
  (value ?? "").replace(/\D/g, "");

type SavedLead = {
  name: string;
  caseType: string;
  phone: string | null;
  email: string | null;
} | null;

export const leadMatches = (
  expected: NonNullable<EvalCase["expect"]["lead"]>,
  saved: SavedLead,
) =>
  saved !== null &&
  saved.name.trim().toLowerCase() === expected.name.toLowerCase() &&
  saved.caseType === expected.caseType &&
  (!expected.phone || digits(saved.phone) === digits(expected.phone)) &&
  (!expected.email ||
    saved.email?.toLowerCase() === expected.email.toLowerCase());

export type CaseOutcome = {
  intent: string | null;
  answer: string;
  retrievedRefs: string[];
  citedRefs: string[];
  invalidCitations: number;
  lead: SavedLead;
  hasHandoff: boolean;
};

// Each check is null when it doesn't apply to the case.
export const scoreCase = (c: EvalCase, o: CaseOutcome) => {
  const { expect } = c;
  const intentOk = o.intent === expect.intent;
  const hasSections = Boolean(expect.sections?.length);

  const checks = {
    intentOk,
    retrievalHit: hasSections
      ? o.retrievedRefs.some((ref) => expect.sections!.includes(ref))
      : null,
    reciprocalRank: hasSections
      ? reciprocalRank(o.retrievedRefs, expect.sections!)
      : null,
    citationOk: hasSections
      ? o.citedRefs.some((ref) => expect.sections!.includes(ref))
      : null,
    factsOk:
      expect.mustInclude?.length || expect.mustNotInclude?.length
        ? (expect.mustInclude?.length
            ? containsAll(o.answer, expect.mustInclude)
            : true) &&
          (expect.mustNotInclude?.length
            ? containsNone(o.answer, expect.mustNotInclude)
            : true)
        : null,
    notFoundOk:
      expect.notFound !== undefined
        ? isNotFoundReply(o.answer) === expect.notFound
        : c.category === "answerable"
          ? !isNotFoundReply(o.answer)
          : null,
    leadOk:
      expect.lead || expect.noLead || expect.handoff !== undefined
        ? (expect.lead ? leadMatches(expect.lead, o.lead) : true) &&
          (expect.noLead ? o.lead === null : true) &&
          (expect.handoff !== undefined
            ? o.hasHandoff === expect.handoff
            : true)
        : null,
  };

  const passed =
    intentOk &&
    o.invalidCitations === 0 &&
    [
      checks.retrievalHit,
      checks.citationOk,
      checks.factsOk,
      checks.notFoundOk,
      checks.leadOk,
    ].every((v) => v !== false);

  return { ...checks, passed };
};

export const rate = (values: (boolean | null)[]) => {
  const applicable = values.filter((v): v is boolean => v !== null);
  return applicable.length
    ? applicable.filter(Boolean).length / applicable.length
    : null;
};

export const percentile = (values: number[], p: number) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  ]!;
};
