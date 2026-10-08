// Reviewed, fixed texts. Changing one is a product decision, not a prompt tweak.
export const NOTICE = "General information only — not legal advice.";

export const LEGAL_ADVICE_REPLY =
  "I can't give legal advice about your own situation — only a lawyer who knows the details can do that. " +
  "Harbor & Vale Law offers a free 30-minute consultation, in person or by video. Would you like me to pass your details to our team?";

export const OUT_OF_SCOPE_REPLY =
  "I can only help with questions about Harbor & Vale Law — our services, fees, locations and how to work with us.";

export const SMALL_TALK_REPLY =
  "Hi! I can answer questions about Harbor & Vale Law's services, fees, locations and attorneys, or help you get in touch with our team.";

export const leadSavedReply = (name: string) =>
  `Thank you, ${name}. I've passed your details to our team, and someone will contact you to arrange your free consultation.`;

export const LEAD_ALREADY_SAVED_REPLY =
  "Our team already has your details and will be in touch. Is there anything else I can help with?";

export const HANDOFF_REPLY =
  "I've asked a member of our team to review this conversation. You can also call us on (602) 555-0142, Monday to Friday 8:00–18:00.";

// Fixed, so a model can't phrase it as legal advice; fields are named in plain words.
export const missingDetailsReply = (fields: string[]) =>
  `To pass your details to our team I still need ${fields.join(" and ")}. Could you share ${fields.length > 1 ? "them" : "it"}?`;
