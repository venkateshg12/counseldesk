import { STAFF_APP_URL } from "../../constants/env.js";

type LeadEmailInput = {
  conversationId: string;
  name: string;
  email: string | null;
  phone: string | null;
  caseType: string;
  summary: string | null;
};

// Visitor-provided text goes into HTML, so it is escaped. A name like "<script>" must stay text.
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export const getNewLeadEmail = (lead: LeadEmailInput) => {
  const link = `${STAFF_APP_URL}/staff/conversations/${lead.conversationId}`;
  const lines = [
    `Name: ${lead.name}`,
    `Email: ${lead.email ?? "—"}`,
    `Phone: ${lead.phone ?? "—"}`,
    `Case type: ${lead.caseType}`,
    `Summary: ${lead.summary ?? "—"}`,
  ];

  return {
    subject: `New lead: ${lead.name} (${lead.caseType})`,
    text: `${lines.join("\n")}\n\nOpen the conversation: ${link}`,
    html: `<p>${lines.map(escapeHtml).join("<br>")}</p><p><a href="${link}">Open the conversation</a></p>`,
  };
};
