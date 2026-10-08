import { useMutation, useQueryClient } from "@tanstack/react-query";
import { resolveHandoff } from "@/api/staff";
import { transcriptKey } from "./useTranscript";

export const useResolveHandoff = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      handoffId,
    }: {
      handoffId: string;
      conversationId: string;
    }) => resolveHandoff(handoffId),
    // Also on error: a 409 means someone else resolved it, so the list is stale either way.
    onSettled: (_data, _error, { conversationId }) => {
      void queryClient.invalidateQueries({ queryKey: ["handoffs"] });
      void queryClient.invalidateQueries({
        queryKey: transcriptKey(conversationId),
      });
    },
  });
};
