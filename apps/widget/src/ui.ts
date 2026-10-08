import type { Citation } from "@repo/types";

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
) => {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs))
    node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
};

// Only links to the firm's own site become clickable; anything else is shown as plain text.
const safeHref = (url: string, siteOrigin: string) => {
  try {
    const parsed = new URL(url);
    return parsed.origin === siteOrigin ? parsed.href : null;
  } catch {
    return null;
  }
};

const link = (href: string, text: string) => {
  const a = el("a", { href, target: "_blank", rel: "noopener" }, text);
  return a;
};

const CITATION = /(\[\d+(?:\s*,\s*\d+)*\])/;

// Rebuilds an answer bubble: text as text nodes, [n] markers as links to their sections, then a source list.
export const renderAnswer = (
  bubble: HTMLElement,
  text: string,
  citations: Citation[],
  siteOrigin: string,
) => {
  bubble.replaceChildren();
  const byNumber = new Map(citations.map((c) => [c.number, c]));

  for (const part of text.split(CITATION)) {
    if (!CITATION.test(part)) {
      bubble.append(document.createTextNode(part));
      continue;
    }
    for (const n of part
      .slice(1, -1)
      .split(",")
      .map((s) => Number(s.trim()))) {
      const citation = byNumber.get(n);
      const href = citation ? safeHref(citation.url, siteOrigin) : null;
      bubble.append(
        href ? link(href, `[${n}]`) : document.createTextNode(`[${n}]`),
      );
    }
  }

  const listed = citations.flatMap((c) => {
    const href = safeHref(c.url, siteOrigin);
    return href ? [link(href, `[${c.number}] ${c.heading}`)] : [];
  });
  if (listed.length) {
    const sources = el("div", { class: "sources" });
    sources.append(el("div", {}, "Sources"), ...listed);
    bubble.append(sources);
  }
};

export const appendNotice = (bubble: HTMLElement, text: string) => {
  bubble.append(el("div", { class: "notice" }, text));
};

export const appendActions = (
  bubble: HTMLElement,
  actions: { label: string; onClick: () => void }[],
) => {
  const row = el("div", { class: "actions" });
  for (const action of actions) {
    const button = el("button", { type: "button" }, action.label);
    button.addEventListener("click", () => {
      row.remove(); // one click per offer
      action.onClick();
    });
    row.append(button);
  }
  bubble.append(row);
};
