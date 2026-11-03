import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAppointments, updateAppointment } from "@/api/staff";

export const useAppointments = (params: {
  from?: string;
  attorneyId?: string;
}) =>
  useQuery({
    queryKey: ["appointments", params],
    queryFn: () => getAppointments(params),
  });

export const useUpdateAppointment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: "completed" | "no_show" | "cancelled";
    }) => updateAppointment(id, status),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["appointments"] }),
  });
};
