import { answerV1 } from "./answer.v1.js";
import { answerV2 } from "./answer.v2.js";

export { NOT_FOUND_REPLY, type Source } from "./answer.v1.js";
export { answerV2 } from "./answer.v2.js";
export { routerV1, routeSchema, type Route } from "./router.v1.js";
export * from "./lead.v1.js";
export * from "./replies.js";

// Every version ever shipped stays here, so old configurations can be re-run for comparison.
const ANSWER_PROMPTS = {
  [answerV1.version]: answerV1,
  [answerV2.version]: answerV2,
} as const;

export const getAnswerPrompt = (
  version = process.env.ANSWER_PROMPT_VERSION ?? "answer.v1",
) => {
  const prompt = ANSWER_PROMPTS[version as keyof typeof ANSWER_PROMPTS];
  if (!prompt) throw new Error(`Unknown ANSWER_PROMPT_VERSION "${version}"`);
  return prompt;
};
