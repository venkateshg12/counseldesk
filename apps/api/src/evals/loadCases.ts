import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { evalCaseSchema } from "./schema.js";

const GOLDEN_PATH = fileURLToPath(new URL("./golden.json", import.meta.url));

export const loadCases = ({ subset }: { subset?: "ci" } = {}) => {
  const cases = z
    .array(evalCaseSchema)
    .parse(JSON.parse(readFileSync(GOLDEN_PATH, "utf8")));

  const ids = cases.map((c) => c.id);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) throw new Error(`Duplicate eval case id: ${duplicate}`);

  return subset === "ci" ? cases.filter((c) => c.ci) : cases;
};
