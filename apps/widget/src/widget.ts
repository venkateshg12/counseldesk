import type { Citation } from "@repo/types";
import { postChat, ChatHttpError } from "./api";
import { readEvents } from "./sse";
import { el, renderAnswer, appendNotice, appendActions } from "./ui";
import { styles, extraStyles } from "./styles";

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
  clear: () => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
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
  const reset = el(
    "button",
    { type: "button", class: "reset" },
    "New conversation",
  );
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

  reset.addEventListener("click", () => {
    if (!busy) resetConversation();
  });

  header.append(reset, close);
  form.append(input, sendButton);
  panel.append(header, messages, form);
  root.append(el("style", {}, styles + extraStyles), launcher, panel);

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

  const addMessage = (role: "user" | "assistant", text: string) => {
    const bubble = el("div", { class: `msg ${role}` }, text);
    messages.append(bubble);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  };

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
