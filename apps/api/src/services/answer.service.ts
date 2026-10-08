import { retrieve } from "./search.service.js";
import { getAnswerPrompt, type Source } from "../ai/prompts/index.js";
import type { ChatMessage } from "../ai/types.js";
import { SITE_URL } from "../constants/env.js";
import type { SearchMode } from "../constants/search.js";

type PrepareInput = {
  question: string;
  // Earlier turns of this conversation, oldest first, without the current question.
  history: ChatMessage[];
  mode?: SearchMode;
};

/*
  Everything the answer step needs except the model call itself: retrieval, numbered sources and the
  prompt. The chat (Phase 16) streams the model call; the eval runner (Phase 22) calls the same thing.
 */
export const prepareAnswer = async ({
  question,
  history,
  mode = "hybrid",
}: PrepareInput) => {
  const previousQuestion = [...history]
    .reverse()
    .find((m) => m.role === "user")?.content;
  const retrievalQuery = previousQuestion
    ? `${previousQuestion}\n${question}`
    : question;

  const startedAt = performance.now();
  const retrieval = await retrieve(retrievalQuery, { mode });
  const retrieveMs = Math.round(performance.now() - startedAt);

  const sources: Source[] = retrieval.sections.map((section, index) => ({
    number: index + 1,
    sectionId: section.id,
    url: `${SITE_URL}${section.pagePath}#${section.anchor}`,
    heading: `${section.pageTitle} > ${section.heading}`,
    content: section.content,
  }));

  const prompt = getAnswerPrompt();

  return {
    sources,
    retrieval,
    retrieveMs,
    promptVersion: prompt.version,
    system: prompt.build(sources),
    messages: [...history, { role: "user" as const, content: question }],
  };
};
