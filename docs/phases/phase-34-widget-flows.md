# Phase 34 — Widget flows: notices, errors, cold starts, lead capture UX

## 1. Goal

Make the widget handle every path the API can take, the way a visitor (or a recruiter trying the demo)
will actually hit them:

| Situation                            | What the visitor sees                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| A grounded answer                    | the answer, citations, and a small "General information only — not legal advice." line     |
| A refusal / redirect / lead question | the fixed reply, no notice                                                                 |
| The free-tier API is asleep          | after 3 s with no reply: "Waking up our server — the first reply can take up to a minute." |
| Rate limited (429)                   | the server's message ("Too many requests…") with no retry button                           |
| Model unavailable / network error    | an error line and a **Retry** button that resends the same message                         |
| A very long conversation             | the server's message and a **New conversation** button                                     |
| Wanting a fresh start                | a **New conversation** button in the header                                                |

Plus an opening greeting with three example questions, keyboard and screen-reader support, and a
full-screen layout on phones.

## 2. What I will understand after this phase

1. Why every failure needs a specific, honest message, and which failures deserve a retry.
2. How to detect "the server is waking up" from the client side, without a special endpoint.
3. What accessible chat UI requires: live regions, focus management, keyboard control.
4. How to keep UI state small and explicit in a framework-free component.

## 3. Prerequisites

- Phase 33 done.

## 4. Files

```
apps/widget/src/
├── widget.ts        (notice, wake timer, retry, new conversation, greeting, Escape)
├── ui.ts            (notice line, action buttons)
└── styles.ts        (notice, actions, mobile)
```

## 5. Concepts

**Specific errors.** "Something went wrong" for everything teaches the visitor nothing. Each failure
already arrives distinct: a 429 envelope (wait), an SSE `error` event with `LLM_UNAVAILABLE` (try again
shortly), `CONVERSATION_TOO_LONG` (start over), a network failure (check connection / try again). The
server's message is shown when there is one, and only failures that a retry could fix get a Retry
button: retrying a 429 immediately just gets another 429.

**Cold starts, detected by silence.** The e-commerce client (ShopyMart) showed a "waking up" notice when
a request stayed pending past a few seconds. Same idea here: if no `meta` event (the server's first
byte) arrives within 3 seconds, the bubble says the server is waking up. When the first event arrives,
the note is replaced by the answer. No extra request, no special endpoint — the signal is the delay
itself. `fetch` has no default timeout, so a 60-second cold start just takes 60 seconds.

**Accessible chat.**

- The message list is `role="log"` with `aria-live="polite"`: screen readers announce new messages
  without interrupting.
- Opening the panel moves focus to the input; Escape closes it and returns focus to the launcher.
- Buttons have text or `aria-label`s; the send button is disabled while a reply streams, and that state
  is exposed through the `disabled` attribute.
- Streaming text is announced once complete, not word by word: while streaming, the bubble is
  `aria-busy="true"`, which tells assistive tech to wait.

**Keeping state explicit.** The widget has four pieces of state: `conversationId`, `busy`, `lastMessage`
(for Retry) and whether the panel is open. Everything else is derived from events. A framework would
add a lot of code for four variables.

## 6. Steps

### Step 1 — Styles

Append to `styles.ts`:

```ts
export const extraStyles = `
.notice { margin-top: 6px; font-size: 11px; color: #57534e; }
.actions { display: flex; gap: 8px; margin-top: 8px; }
.actions button { border: 1px solid #115e59; background: #fff; color: #115e59; border-radius: 999px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
.examples { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.examples button { text-align: left; border: 1px solid #d6d3d1; background: #fff; border-radius: 10px; padding: 6px 10px; font-size: 13px; cursor: pointer; color: #1c1917; }
.msg.system { align-self: center; background: transparent; color: #57534e; font-size: 12px; text-align: center; }
.header .reset { margin-left: auto; font-size: 12px; font-weight: 400; border: 1px solid rgba(255,255,255,.5); border-radius: 999px; padding: 2px 10px; }
.header .reset + button { margin-left: 4px; }
@media (max-width: 480px) {
  .panel { right: 0; bottom: 0; width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; }
}
`;
```

and include it: `root.append(el("style", {}, styles + extraStyles), …)`.

### Step 2 — UI helpers

Append to `ui.ts`:

```ts
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
```

### Step 3 — Flows in `widget.ts`

Replace the body of `send` and add the helpers. The full new version of the stateful part:

```ts
const WAKE_NOTICE_MS = 3_000;
const GREETING =
  "Hi! I can answer questions about Harbor & Vale Law — our services, fees, locations and how to work with us.";
const EXAMPLES = [
  "Do you handle DUI cases?",
  "How much is a first consultation?",
  "What are your office hours?",
];

let conversationId = storage.get();
let busy = false;

const greet = () => {
  const bubble = addMessage("assistant", GREETING);
  const examples = el("div", { class: "examples" });
  for (const question of EXAMPLES) {
    const button = el("button", { type: "button" }, question);
    button.addEventListener("click", () => {
      examples.remove();
      void send(question);
    });
    examples.append(button);
  }
  bubble.append(examples);
};

const resetConversation = () => {
  conversationId = undefined;
  storage.clear();
  messages.replaceChildren();
  greet();
  input.focus();
};

const send = async (message: string) => {
  busy = true;
  sendButton.disabled = true;
  addMessage("user", message);
  const bubble = addMessage("assistant", "…");
  bubble.setAttribute("aria-busy", "true");

  let text = "";
  let citations: Citation[] = [];
  let firstEventSeen = false;
  const wakeTimer = setTimeout(() => {
    if (!firstEventSeen)
      bubble.textContent =
        "Waking up our server — the first reply can take up to a minute.";
  }, WAKE_NOTICE_MS);

  const showError = (messageText: string, retryable: boolean) => {
    bubble.textContent = messageText;
    if (retryable)
      appendActions(bubble, [
        { label: "Retry", onClick: () => void send(message) },
      ]);
  };

  try {
    const response = await postChat(apiUrl, { message, conversationId });
    for await (const event of readEvents(response.body!)) {
      firstEventSeen = true;
      if (event.type === "meta") {
        conversationId = event.conversationId;
        storage.set(conversationId);
        bubble.textContent = "…";
      } else if (event.type === "token") {
        text += event.text;
        bubble.textContent = text;
        messages.scrollTop = messages.scrollHeight;
      } else if (event.type === "citations") {
        citations = event.citations;
      } else if (event.type === "done") {
        renderAnswer(bubble, text, citations, siteOrigin);
        if (event.notice) appendNotice(bubble, event.notice);
      } else if (event.type === "error") {
        if (event.code === "CONVERSATION_TOO_LONG") {
          bubble.textContent = event.message;
          appendActions(bubble, [
            { label: "New conversation", onClick: resetConversation },
          ]);
        } else {
          showError(
            event.message,
            event.code === "LLM_UNAVAILABLE" ||
              event.code === "INTERNAL_SERVER_ERROR",
          );
        }
      }
    }
  } catch (error) {
    if (error instanceof ChatHttpError) {
      // 429 and 400 are not fixed by retrying right away; network-level and 5xx failures may be.
      showError(error.message, error.status >= 500);
    } else {
      showError(
        "Couldn't reach the assistant. Check your connection and try again.",
        true,
      );
    }
  } finally {
    clearTimeout(wakeTimer);
    bubble.removeAttribute("aria-busy");
    busy = false;
    sendButton.disabled = false;
    input.focus();
  }
};
```

Add `clear` to the `storage` helper (`sessionStorage.removeItem(STORAGE_KEY)` inside `try`).

In the header, add a reset button before the close button:

```ts
const reset = el(
  "button",
  { type: "button", class: "reset" },
  "New conversation",
);
reset.addEventListener("click", () => {
  if (!busy) resetConversation();
});
header.append(reset, close);
```

Show the greeting once, when the panel is first opened and there is no conversation:

```ts
let greeted = false;
const setOpen = (open: boolean) => {
  panel.dataset["open"] = String(open);
  launcher.setAttribute("aria-expanded", String(open));
  if (open) {
    if (!greeted) {
      greeted = true;
      greet();
    }
    input.focus();
  } else {
    launcher.focus();
  }
};

// Escape closes the panel from anywhere inside it.
panel.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setOpen(false);
});
```

Notes:

- A reloaded page keeps `conversationId` (sessionStorage) but not the message bubbles: the widget
  doesn't fetch history (there's no public history endpoint, deliberately — it would be a way to read a
  conversation by id). The visitor sees the greeting and continues; the server still has the context.
  Say so in the README's known limitations.
- The lead flow needs no special UI: questions and confirmations are ordinary messages. That's a
  deliberate choice: one rendering path, and the fixed texts from Phase 18 already read well as chat.

### Step 4 — Make the API errors carry codes the widget uses

Check that these reach the widget with the codes it switches on (they should already, from Phases 14,
16 and 24): `LLM_UNAVAILABLE` (SSE error), `CONVERSATION_TOO_LONG` (SSE error — it's thrown inside
`handleMessage`, after headers), `TOO_MANY_REQUESTS` (429 JSON, before streaming).

## 7. Commit points

1. `feat(widget): add greeting with example questions and new-conversation reset`
2. `feat(widget): show not-legal-advice notice, specific errors and retry`
3. `feat(widget): show a waking-up notice during cold starts`
4. `feat(widget): keyboard, screen-reader and mobile support`

## 8. Verify

On `http://localhost:3000` with the API running:

- First open: greeting and three example buttons; clicking one asks it.
- A question → answer, citations, and the small notice line. "Will I go to jail?" → refusal, no notice.
- Stop the API, send a message → "Couldn't reach the assistant…" + **Retry**; start the API, click
  Retry → answer arrives.
- Cold start, simulated: in the API, temporarily add `await new Promise((r) => setTimeout(r, 8000))` at
  the top of `chatHandler`, ask → "Waking up our server…" after 3 s, then the answer. Remove the delay.
- Rate limit: send 21 quick messages (or lower the limit temporarily) → the server's 429 message, no Retry.
- Keyboard only: Tab to the launcher, Enter opens with focus in the input, Enter sends, Escape closes and
  focus returns to the launcher.
- Phone width (browser dev tools, 375 px): the panel fills the screen.
- Screen reader (VoiceOver or NVDA, five minutes): a new answer is announced once, after it finishes.

## 9. Common mistakes

- **A Retry button on a 429.** It invites the exact behaviour the limit exists to stop.
- **"Server error" for a cold start.** It isn't an error; the notice says what's actually happening.
- **Announcing every token** to screen readers (no `aria-busy`): an unusable stream of fragments.
- **A public "get conversation" endpoint for restoring history.** Anyone with an id could read a
  visitor's messages.
- **Losing focus after sending.** Keyboard users then have to find the input again for every message.

## 10. Interview prep

**Q: How does the widget behave when your free-tier backend is asleep?**
A: If the stream's first event doesn't arrive within three seconds, the reply bubble says the server is
waking up and the first reply can take up to a minute; when the stream starts, the notice is replaced.
No special endpoint — the delay itself is the signal.

**Q: How did you handle errors in the widget?**
A: Each failure maps to a specific message from the server's envelope or SSE error event, and only
failures a retry can fix get a Retry button — not 429s or validation errors.

**Q: What did you do for accessibility?**
A: A polite live region with `aria-busy` during streaming so answers are announced once, focus moved to
the input on open and back to the launcher on Escape, labelled controls, and a full-screen layout on
small screens.

## 11. Resume-safe claim

"Designed the widget's failure UX — cold-start notice, specific error states with retry where it helps,
conversation reset — and made it keyboard- and screen-reader-accessible."

## 12. Definition of done

- [ ] Every row of the table in section 1 reproduced and behaving as described
- [ ] Keyboard-only and screen-reader checks done
- [ ] Phone layout checked
- [ ] Widget tests, typecheck, lint and build pass
