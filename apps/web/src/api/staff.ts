import API from "@/lib/api";

type Envelope<T, M = undefined> = { status: "success"; data: T; meta: M };
export type PageMeta = {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

export type LeadRow = {
  id: string;
  conversationId: string;
  name: string;
  email: string | null;
  phone: string | null;
  caseType: string;
  summary: string | null;
  notifiedAt: string | null;
  createdAt: string;
};

export type HandoffRow = {
  id: string;
  conversationId: string;
  reason: string;
  status: "pending" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
  leadName: string | null;
  lastMessage: string | null;
};

export type Transcript = {
  conversation: { id: string; status: string; createdAt: string };
  lead: LeadRow | null;
  handoff: { id: string; status: string; reason: string } | null;
  messages: {
    id: string;
    role: "user" | "assistant";
    content: string;
    intent: string | null;
    createdAt: string;
    citations: { number: number; url: string; heading: string }[];
  }[];
};

export const getLeads = async (page: number) =>
  (
    await API.get<Envelope<LeadRow[], PageMeta>>("/staff/leads", {
      params: { page, limit: 25 },
    })
  ).data;

export const getHandoffs = async (
  status: "pending" | "resolved",
  page: number,
) =>
  (
    await API.get<Envelope<HandoffRow[], PageMeta>>("/staff/handoffs", {
      params: { status, page, limit: 25 },
    })
  ).data;

export const getTranscript = async (id: string) =>
  (await API.get<Envelope<Transcript>>(`/staff/conversations/${id}`)).data.data;

export const resolveHandoff = async (id: string) =>
  API.post(`/staff/handoffs/${id}/resolve`);

export const getStats = async (days: number) =>
  (await API.get<Envelope<StaffStats>>("/staff/stats", { params: { days } }))
    .data.data;

export type StaffStats = {
  days: number;
  pricesAsOf: string;
  totals: Record<string, number>;
  answers: {
    count: number;
    firstTokenP50: number | null;
    firstTokenP95: number | null;
    totalP50: number | null;
    totalP95: number | null;
    avgRouteMs: number | null;
    avgRetrieveMs: number | null;
  };
  intents: { intent: string | null; messages: number }[];
  calls: {
    purpose: string;
    provider: string;
    calls: number;
    errorRate: number;
    fallbackRate: number;
    p50Ms: number | null;
    p95Ms: number | null;
    avgInputTokens: number | null;
    avgOutputTokens: number | null;
    estimatedCostUsd: number;
  }[];
};
