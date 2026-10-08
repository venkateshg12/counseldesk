import { useQuery } from "@tanstack/react-query";
import { getMe } from "@/api/auth";

export const ME_KEY = ["me"] as const;

// The session check. A 401 is an answer ("not signed in"), not a failure to retry.
export const useMe = () =>
  useQuery({
    queryKey: ME_KEY,
    queryFn: getMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
