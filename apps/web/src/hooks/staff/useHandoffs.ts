import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getHandoffs } from "@/api/staff";

export const useHandoffs = (status: "pending" | "resolved", page: number) =>
  useQuery({
    queryKey: ["handoffs", status, page],
    queryFn: () => getHandoffs(status, page),
    placeholderData: keepPreviousData,
  });
