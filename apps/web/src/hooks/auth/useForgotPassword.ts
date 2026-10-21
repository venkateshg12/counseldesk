import { useMutation } from "@tanstack/react-query";
import { forgotPassword } from "@/api/auth";

export const useForgotPassword = () =>
  useMutation({ mutationFn: forgotPassword });
