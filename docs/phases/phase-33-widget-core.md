# Phase 33 — The chat widget: core

## 1. Goal

Build `apps/widget`: one JavaScript file that any website can include with a single tag —

```html
<script
  src="https://site.example/widget/counseldesk.js"
  data-api-url="https://api.example"
  async
></script>
```

— and that adds a chat bubble. Clicking it opens a panel; the visitor's question is posted to
`/chat`; the answer streams in word by word; when it finishes, `[1] [2]` become links to the exact
sections, with a short list of sources underneath.

No framework: plain TypeScript and the DOM, rendered inside a **Shadow DOM** so the host site's CSS
can't break the widget and the widget's CSS can't leak into the site. The Next.js site loads it like any
third-party site would.

## 2. What I will understand after this phase

1. What an embeddable script is and how it reads its configuration from its own `<script>` tag.
2. What Shadow DOM isolates, and why a widget needs it.
3. How to read a streamed `fetch` response and parse SSE by hand (and why the parser is tested).
4. Why every piece of model output goes into the page with `textContent`, never `innerHTML`.
5. Why a library build (one IIFE file) differs from an app build.

## 3. Prerequisites

- Phase 32 done; the API runs locally with `CORS_ORIGIN` including `http://localhost:3000` and
  `http://localhost:5173` (the widget's dev server).

## 4. Files

```
apps/widget/
├── package.json
├── tsconfig.json
├── eslint.config.js
├── vite.config.ts
├── index.html                 dev harness
└── src/
    ├── main.ts                entry: reads the script tag, mounts
    ├── widget.ts              state, events, sending
    ├── ui.ts                  DOM helpers, answer rendering
    ├── api.ts                 POST /chat
    ├── sse.ts                 SSE parser
    ├── sse.test.ts
    └── styles.ts
apps/web/
├── package.json               (widget dependency; copy script)
├── scripts/copy-widget.mjs    NEW
└── src/app/layout.tsx         (loads the widget)
```

## 5. Concepts

**Embeddable script.** A script tag can carry its configuration in `data-*` attributes. While a classic
script runs, `document.currentScript` is that `<script>` element, so the widget reads `data-api-url`
from it at the very top of the file (later, `currentScript` is `null`). The file is an **IIFE** — one
self-contained function that runs immediately — so it defines nothing global except what it means to,
and works with a plain `<script>` tag, no module loader.

**Shadow DOM.** `host.attachShadow({ mode: "open" })` gives the widget its own DOM subtree whose styles
are scoped: the host site's `button { … }` rules don't reach inside, and the widget's `.panel { … }`
doesn't reach out. `:host { all: initial; }` also stops inherited styles (font, colour) from leaking in.
Without it, a widget on someone else's site looks different on every site.

**Streaming `fetch`.** `fetch` resolves as soon as headers arrive; `response.body` is a stream of bytes
as they come. The widget decodes them (a streaming `TextDecoder`), accumulates text, and splits complete
events on the blank line that ends each SSE event. A network chunk can end in the middle of an event —
or in the middle of a multi-byte character — so the parser keeps the unfinished part in a buffer. That
edge is exactly what the unit test covers.

**`textContent`, never `innerHTML`.** The answer text comes from a model that read text visitors and
website editors wrote. Inserting it as HTML would let a crafted answer inject script into the firm's
site (cross-site scripting). Every string goes in with `textContent`; links are created with
`createElement("a")` and an `href` that is checked to point at the firm's own site.

**Library build.** An app build produces an HTML page and many hashed chunks. A library build produces
one file with a fixed name meant to be included elsewhere. Vite's library mode with the `iife` format
does that.

**Module resolution for a bundled package.** The API is run by Node, which needs `.js` in every import
(Phase 00). The widget is bundled by Vite into one file, so it uses `moduleResolution: "Bundler"` and
plain extensionless imports — the right setting depends on who resolves the imports at the end.

## 6. Steps

### Step 1 — Package

`apps/widget/package.json`:

```json
{
  "name": "widget",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./counseldesk.js": "./dist/counseldesk.js"
  },
  "scripts": {
    "dev": "vite --port 5173",
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --max-warnings=0",
    "test": "vitest run"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/types": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "eslint": "^9.39.5",
    "typescript": "5.9.3",
    "vite": "^8.3.3",
    "vitest": "^5.0.3"
  }
}
```

`@repo/types` is a dev dependency because only its **types** are used (`import type`), which vanish
from the bundle.

`tsconfig.json`:

```json
{
  "extends": "@repo/typescript-config/base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true
  },
  "include": ["src", "vite.config.ts"]
}
```

`eslint.config.js`: the same two lines as `packages/types`.

`vite.config.ts`:

```ts
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // One self-contained file with a fixed name, runnable from a plain <script> tag.
    lib: {
      entry: "src/main.ts",
      name: "CounselDesk",
      formats: ["iife"],
      fileName: () => "counseldesk.js",
    },
    target: "es2020",
  },
});
```

`index.html` — a dev page that plays the role of "someone's website":

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Widget dev page</title>
    <style>
      /* Hostile host styles: the widget must look the same anyway. */
      * {
        font-family: "Comic Sans MS", cursive !important;
        color: purple;
      }
      button {
        background: yellow;
      }
    </style>
  </head>
  <body>
    <h1>Some other website</h1>
    <script
      type="module"
      src="/src/main.ts"
      data-api-url="http://localhost:4000"
      data-site-url="http://localhost:3000"
    ></script>
  </body>
</html>
```

(In dev, Vite serves the entry as a module, and `document.currentScript` is `null` for module scripts.
`main.ts` falls back to the first script tag that has `data-api-url`, covered below.)

### Step 2 — `src/sse.ts` and its test

```ts
import type { ChatEvent } from "@repo/types";

// Yields complete SSE events from a streamed body. A network chunk may end mid-event, so the
// unfinished tail stays in the buffer until the rest arrives.
export async function* readEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    // stream: true keeps an incomplete multi-byte character for the next chunk instead of mangling it.
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      // Comment lines (": ping") have no data and are skipped.
      if (data) yield JSON.parse(data) as ChatEvent;
      boundary = buffer.indexOf("\n\n");
    }
  }
}
```

`decode(value, { stream: true })` handles a multi-byte character (an accented letter, an emoji) split
across two network chunks: the decoder holds the first half until the second arrives. Decoding each
chunk without `stream: true` would corrupt it. (`body.pipeThrough(new TextDecoderStream())` does the
same, but with TypeScript 5.9's DOM types it doesn't type-check on a `Uint8Array` stream without a
cast — checked while writing this phase.)

`src/sse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readEvents } from "./sse";

// A stream that delivers the given strings as separate chunks.
const streamOf = (...chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks)
        controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });

const collect = async (stream: ReadableStream<Uint8Array>) => {
  const events = [];
  for await (const event of readEvents(stream)) events.push(event);
  return events;
};

describe("readEvents", () => {
  it("parses complete events", async () => {
    const events = await collect(
      streamOf('event: token\ndata: {"type":"token","text":"Hi"}\n\n'),
    );
    expect(events).toEqual([{ type: "token", text: "Hi" }]);
  });

  it("joins an event split across chunks", async () => {
    const events = await collect(
      streamOf('event: token\ndata: {"type":"tok', 'en","text":"Hi"}\n', "\n"),
    );
    expect(events).toEqual([{ type: "token", text: "Hi" }]);
  });

  it("handles several events in one chunk and skips heartbeats", async () => {
    const events = await collect(
      streamOf(
        ': ping\n\ndata: {"type":"token","text":"a"}\n\ndata: {"type":"token","text":"b"}\n\n',
      ),
    );
    expect(events.map((e) => (e.type === "token" ? e.text : ""))).toEqual([
      "a",
      "b",
    ]);
  });

  it("keeps a multi-byte character split across chunks intact", async () => {
    const bytes = new TextEncoder().encode(
      'data: {"type":"token","text":"é"}\n\n',
    );
    const cut = bytes.indexOf(0xc3) + 1; // split inside the two-byte "é"
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });
    expect(await collect(stream)).toEqual([{ type: "token", text: "é" }]);
  });
});
```

Vitest runs in Node, which has `ReadableStream`, `TextEncoder` and `TextDecoderStream` built in.

### Step 3 — `src/api.ts`

```ts
import type { ChatRequest } from "@repo/types";

export class ChatHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Opens the chat stream. Errors detected before streaming (validation, rate limit) come back as a
// normal JSON envelope, turned into a ChatHttpError with the server's message.
export const postChat = async (
  apiUrl: string,
  body: ChatRequest,
  signal?: AbortSignal,
) => {
  const response = await fetch(`${apiUrl}/chat`, {
    method: "POST",
    credentials: "include", // sends the visitorId cookie that owns the conversation
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    const envelope = (await response.json().catch(() => null)) as {
      errors?: { message?: string }[];
    } | null;
    throw new ChatHttpError(
      envelope?.errors?.[0]?.message ??
        "Something went wrong. Please try again.",
      response.status,
    );
  }
  return response;
};
```

`credentials: "include"` is what makes the browser send (and accept) the `visitorId` cookie on a
cross-origin request; the API's CORS answers with `Access-Control-Allow-Credentials: true` for allowed
origins only (Phase 24).

### Step 4 — `src/styles.ts`

```ts
// Scoped to the shadow root. `all: initial` on the host stops the page's inherited styles leaking in.
export const styles = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.launcher { position: fixed; right: 20px; bottom: 20px; width: 56px; height: 56px; border-radius: 50%;
  border: none; background: #115e59; color: #fff; font-size: 24px; cursor: pointer;
  box-shadow: 0 6px 20px rgba(0,0,0,.2); z-index: 2147483000; }
.panel { position: fixed; right: 20px; bottom: 88px; width: 380px; max-width: calc(100vw - 40px);
  height: 560px; max-height: calc(100vh - 120px); display: none; flex-direction: column; background: #fff;
  border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,.25); overflow: hidden; z-index: 2147483000; color: #1c1917; }
.panel[data-open="true"] { display: flex; }
.header { display: flex; align-items: center; gap: 8px; padding: 14px 16px; background: #115e59; color: #fff; font-weight: 600; }
.header button { margin-left: auto; background: transparent; border: none; color: #fff; font-size: 20px; cursor: pointer; }
.messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; font-size: 14px; line-height: 1.5; }
.msg { max-width: 85%; padding: 10px 12px; border-radius: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.msg.user { align-self: flex-end; background: #115e59; color: #fff; }
.msg.assistant { align-self: flex-start; background: #f5f5f4; }
.msg a { color: #115e59; font-weight: 600; }
.sources { margin-top: 8px; padding-top: 8px; border-top: 1px solid #e7e5e4; font-size: 12px; }
.sources a { display: block; color: #115e59; text-decoration: underline; }
.form { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #e7e5e4; }
.form textarea { flex: 1; resize: none; border: 1px solid #d6d3d1; border-radius: 10px; padding: 8px 10px; font-size: 14px; color: #1c1917; }
.form button { border: none; background: #115e59; color: #fff; border-radius: 10px; padding: 0 14px; cursor: pointer; }
.form button:disabled { opacity: .5; cursor: default; }
`;
```

### Step 5 — `src/ui.ts`

```ts
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
```

- `text.split(CITATION)` with a capturing group keeps the markers in the result array, alternating
  with the text between them.
- Citation links open in a new tab, so the conversation stays open on the original page.
- `rel="noopener"` stops the opened page from controlling this one through `window.opener`.

### Step 6 — `src/widget.ts`

```ts
import type { Citation } from "@repo/types";
import { postChat, ChatHttpError } from "./api";
import { readEvents } from "./sse";
import { el, renderAnswer } from "./ui";
import { styles } from "./styles";

const STORAGE_KEY = "counseldesk:conversationId";

// sessionStorage can throw (privacy modes, sandboxed frames); the widget must work without it.
const storage = {
  get: () => {
    try {
      return sessionStorage.getItem(STORAGE_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  },
  set: (value: string) => {
    try {
      sessionStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* not persisted; the conversation still works for this page view */
    }
  },
};

export const mountWidget = ({
  apiUrl,
  siteOrigin,
}: {
  apiUrl: string;
  siteOrigin: string;
}) => {
  const host = el("div", { id: "counseldesk-widget" });
  document.body.append(host);
  const root = host.attachShadow({ mode: "open" });

  const launcher = el(
    "button",
    { class: "launcher", type: "button", "aria-label": "Open chat" },
    "💬",
  );
  const panel = el("section", {
    class: "panel",
    "aria-label": "Chat with Harbor & Vale Law",
  });
  const header = el("div", { class: "header" }, "Ask Harbor & Vale Law");
  const close = el(
    "button",
    { type: "button", "aria-label": "Close chat" },
    "×",
  );
  const messages = el("div", {
    class: "messages",
    role: "log",
    "aria-live": "polite",
  });
  const form = el("form", { class: "form" });
  const input = el("textarea", {
    rows: "2",
    placeholder: "Type your question…",
    "aria-label": "Your message",
    maxlength: "1000",
  });
  const sendButton = el("button", { type: "submit" }, "Send");

  header.append(close);
  form.append(input, sendButton);
  panel.append(header, messages, form);
  root.append(el("style", {}, styles), launcher, panel);

  let conversationId = storage.get();
  let busy = false;

  const setOpen = (open: boolean) => {
    panel.dataset["open"] = String(open);
    launcher.setAttribute("aria-expanded", String(open));
    if (open) input.focus();
  };

  const addMessage = (role: "user" | "assistant", text: string) => {
    const bubble = el("div", { class: `msg ${role}` }, text);
    messages.append(bubble);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  };

  const send = async (message: string) => {
    busy = true;
    sendButton.disabled = true;
    addMessage("user", message);
    const bubble = addMessage("assistant", "…");
    let text = "";
    let citations: Citation[] = [];

    try {
      const response = await postChat(apiUrl, { message, conversationId });
      for await (const event of readEvents(response.body!)) {
        if (event.type === "meta") {
          conversationId = event.conversationId;
          storage.set(conversationId);
        } else if (event.type === "token") {
          text += event.text;
          bubble.textContent = text;
          messages.scrollTop = messages.scrollHeight;
        } else if (event.type === "citations") {
          citations = event.citations;
        } else if (event.type === "done") {
          renderAnswer(bubble, text, citations, siteOrigin);
        } else if (event.type === "error") {
          bubble.textContent = event.message;
        }
      }
    } catch (error) {
      bubble.textContent =
        error instanceof ChatHttpError
          ? error.message
          : "Couldn't reach the assistant. Please try again.";
    } finally {
      busy = false;
      sendButton.disabled = false;
      input.focus();
    }
  };

  launcher.addEventListener("click", () =>
    setOpen(panel.dataset["open"] !== "true"),
  );
  close.addEventListener("click", () => setOpen(false));

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || busy) return;
    input.value = "";
    void send(message);
  });

  // Enter sends, Shift+Enter adds a line.
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
};
```

### Step 7 — `src/main.ts`

```ts
import { mountWidget } from "./widget";

// Read while this script is executing: afterwards document.currentScript is null. Module scripts (the
// Vite dev page) never set it, so fall back to the first tag that carries the config.
const script =
  (document.currentScript as HTMLScriptElement | null) ??
  document.querySelector<HTMLScriptElement>("script[data-api-url]");

const apiUrl = script?.dataset["apiUrl"]?.replace(/\/$/, "");
const siteUrl = script?.dataset["siteUrl"];

if (!apiUrl) {
  console.error("[counseldesk] the script tag needs data-api-url");
} else {
  const start = () =>
    mountWidget({
      apiUrl,
      siteOrigin: siteUrl ? new URL(siteUrl).origin : location.origin,
    });
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else start();
}
```

### Step 8 — Serve it from the Next.js site

In `apps/web/package.json`, add `"widget": "workspace:*"` to `devDependencies`, and scripts:

```json
"predev": "node scripts/copy-widget.mjs",
"prebuild": "node scripts/copy-widget.mjs"
```

`apps/web/scripts/copy-widget.mjs`:

```js
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

// Copies the built widget into public/ so the site serves it at /widget/counseldesk.js.
const require = createRequire(import.meta.url);
let source;
try {
  source = require.resolve("widget/counseldesk.js");
} catch {
  console.warn(
    "[copy-widget] widget not built yet — run: pnpm --filter widget build",
  );
  process.exit(0);
}
mkdirSync("public/widget", { recursive: true });
copyFileSync(source, "public/widget/counseldesk.js");
```

Because `web` depends on `widget`, Turbo's `^build` builds the widget before the site. Add
`apps/web/public/widget/` to `.gitignore` (it's a build output).

In `apps/web/src/app/layout.tsx`, load it like any third-party site would:

```tsx
import Script from "next/script";
// … inside <body>, after {children}:
<Script
  src="/widget/counseldesk.js"
  data-api-url={process.env.NEXT_PUBLIC_API_URL}
  strategy="afterInteractive"
/>;
```

The staff pages don't need the widget; hide it there in Phase 35 by moving this `<Script>` into the
site's layout only.

## 7. Commit points

1. `feat(widget): add tested sse parser`
2. `feat(widget): add shadow-dom chat widget with streaming answers and safe citation links`
3. `feat(web): serve and load the widget on the demo site`

## 8. Verify

```bash
pnpm --filter widget test           # 4 sse tests
pnpm --filter widget build          # dist/counseldesk.js — note its size (aim: well under 20 KB gzipped)
pnpm --filter widget dev            # http://localhost:5173: hostile styles on the page, widget looks normal

pnpm --filter api dev
pnpm --filter web build && pnpm --filter web start
# http://localhost:3000 → bubble → "What are your DUI fees?" → words stream in → [1] becomes a link
# → click it: new tab on /fees#dui-fees, heading highlighted
# Reload the page and ask a follow-up: same conversation (sessionStorage)

# XSS check: ask "Reply with exactly: <img src=x onerror=alert(1)>" — the text appears literally, no alert.
```

## 9. Common mistakes

- **Reading `document.currentScript` inside a callback.** It's `null` by then; read it at the top level.
- **`innerHTML` for the answer** "to render the links". That's the XSS hole; build nodes.
- **Linking any URL the model produced.** Only the firm's origin is linked.
- **Splitting the stream on chunk boundaries** instead of event boundaries; events arrive torn.
- **Decoding each chunk with `new TextDecoder().decode(chunk)`.** Corrupts characters split across
  chunks; use the stream decoder (or `decode(chunk, { stream: true })`).
- **Global CSS for the widget.** Without the shadow root it changes the host site and is changed by it.

## 10. Interview prep

**Q: How is the widget embedded?**
A: One IIFE file built in library mode, included with a script tag whose data attributes configure it.
It renders into a Shadow DOM so styles are isolated in both directions, and talks to the API with
credentialed CORS that only allows known origins.

**Q: How do you stream the answer in the browser?**
A: `fetch` with a POST body, then read `response.body` through a TextDecoderStream and parse SSE
events myself, buffering partial events across network chunks — unit-tested, including a multi-byte
character split between chunks.

**Q: How do you prevent XSS from model output?**
A: Text only ever enters the DOM via `textContent`; citation links are elements I create, with hrefs
validated to the firm's own origin.

## 11. Resume-safe claim

"Built a dependency-free embeddable chat widget (single [N] KB script, Shadow DOM isolation) that
streams answers over SSE via fetch and renders citations as origin-validated deep links, XSS-safe."

## 12. Definition of done

- [ ] SSE parser tests pass, including split events and split characters
- [ ] The widget looks right on the hostile dev page
- [ ] On the site, answers stream and citations link to highlighted sections
- [ ] The XSS check shows text, not an alert
- [ ] Bundle size recorded
