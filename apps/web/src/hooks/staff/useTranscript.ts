import { useQuery } from "@tanstack/react-query";
import { getTranscript } from "@/api/staff";

export const transcriptKey = (id: string) => ["transcript", id] as const;

export const useTranscript = (id: string) =>
  useQuery({ queryKey: transcriptKey(id), queryFn: () => getTranscript(id) });
