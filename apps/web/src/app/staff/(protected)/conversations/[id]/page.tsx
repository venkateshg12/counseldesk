"use client";

import { useParams } from "next/navigation";
import { useTranscript } from "@/hooks/staff/useTranscript";
import { QueryState } from "@/components/staff/QueryState";

export default function TranscriptPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isPending, error } = useTranscript(id);

  return (
    <>
      <h1 className="text-2xl font-bold">Conversation</h1>
      <QueryState
        isPending={isPending}
        error={error}
        isEmpty={false}
        emptyText=""
      />
      {data ? (
        <>
          <p className="mt-2 text-sm text-stone-600">
            Status: {data.conversation.status.replace(/_/g, " ")} · started{" "}
            {new Date(data.conversation.createdAt).toLocaleString()}
            {data.lead
              ? ` · lead: ${data.lead.name}, ${[data.lead.phone, data.lead.email].filter(Boolean).join(" · ")}`
              : ""}
          </p>
          <ol className="mt-6 space-y-4">
            {data.messages.map((message) => (
              <li
                key={message.id}
                className={message.role === "user" ? "text-right" : ""}
              >
                <div
                  className={`inline-block max-w-[80%] rounded-xl px-4 py-3 text-left text-sm whitespace-pre-wrap ${message.role === "user" ? "bg-teal-800 text-white" : "bg-white border border-stone-200"}`}
                >
                  {message.content}
                  {message.citations.length ? (
                    <ul className="mt-2 border-t border-stone-200 pt-2 text-xs">
                      {message.citations.map((c) => (
                        <li key={c.number}>
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                          >
                            [{c.number}] {c.heading}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-stone-500">
                  {message.role === "assistant" && message.intent
                    ? `${message.intent.replace(/_/g, " ")} · `
                    : ""}
                  {new Date(message.createdAt).toLocaleTimeString()}
                </p>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </>
  );
}
