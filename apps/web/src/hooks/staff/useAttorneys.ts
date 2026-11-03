import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AvailabilityRuleInput } from "@repo/types";
import { assignLead, getAttorneys, saveAvailability } from "@/api/staff";

export const useAttorneys = () =>
  useQuery({ queryKey: ["attorneys"], queryFn: getAttorneys });

export const useAssignLead = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      leadId,
      attorneyId,
    }: {
      leadId: string;
      attorneyId: string;
    }) => assignLead(leadId, attorneyId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["leads"] }),
  });
};

export const useSaveAvailability = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      attorneyId,
      rules,
    }: {
      attorneyId: string;
      rules: AvailabilityRuleInput[];
    }) => saveAvailability(attorneyId, rules),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["attorneys"] }),
  });
};
