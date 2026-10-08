import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getLeads } from "@/api/staff";

export const useLeads = (page: number) =>
  useQuery({
    queryKey: ["leads", page],
    queryFn: () => getLeads(page),
    placeholderData: keepPreviousData,
  });
