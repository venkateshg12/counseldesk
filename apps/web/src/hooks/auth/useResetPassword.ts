import { useMutation, useQueryClient } from "@tanstack/react-query";
import { resetPassword } from "@/api/auth";
import { useAuthStore } from "@/store/auth.store";
import { ME_KEY } from "./useMe";

export const useResetPassword = () => {
  const queryClient = useQueryClient();
  const clearAuth = useAuthStore((s) => s.clearAuth);
  return useMutation({
    mutationFn: resetPassword,
    // Every session was ended server-side, so forget the cached identity here too.
    onSuccess: () => {
      clearAuth();
      queryClient.removeQueries({ queryKey: ME_KEY });
    },
  });
};
