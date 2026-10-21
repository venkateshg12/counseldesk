import API from "@/lib/api";
import type {
  StaffForgotPassword,
  StaffLogin,
  StaffResetPassword,
} from "@repo/types";
import type { StaffUser } from "@/store/auth.store";

type Envelope<T> = { status: "success"; data: T };

export const login = async (body: StaffLogin) =>
  (await API.post<Envelope<{ user: StaffUser }>>("/auth/login", body)).data.data
    .user;
export const logout = async () => API.post("/auth/logout");
export const getMe = async () =>
  (await API.get<Envelope<{ user: StaffUser }>>("/auth/me")).data.data.user;
export const forgotPassword = async (body: StaffForgotPassword) =>
  (await API.post<Envelope<{ message: string }>>("/auth/password/forgot", body))
    .data.data.message;
export const resetPassword = async (body: StaffResetPassword) =>
  (await API.post<Envelope<{ message: string }>>("/auth/password/reset", body))
    .data.data.message;
