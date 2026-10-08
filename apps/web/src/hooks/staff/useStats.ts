import { useQuery } from "@tanstack/react-query";
import { getStats } from "@/api/staff";

export const useStats = (days: number) =>
  useQuery({ queryKey: ["stats", days], queryFn: () => getStats(days) });
