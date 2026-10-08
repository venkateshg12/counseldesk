import { useMutation, useQueryClient } from "@tanstack/react-query";
import { login } from "@/api/auth";
import { useAuthStore } from "@/store/auth.store";
import { ME_KEY } from "./useMe";

export const useLogin = () => {
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  return useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      setUser(user);
      queryClient.setQueryData(ME_KEY, user); // the gate doesn't need a second round trip
    },
  });
};
