import API from "@/lib/api";
import type { StaffLogin } from "@repo/types";
import type { StaffUser } from "@/store/auth.store";

type Envelope<T> = { status: "success"; data: T };

export const login = async (body: StaffLogin) =>
  (await API.post<Envelope<{ user: StaffUser }>>("/auth/login", body)).data.data
    .user;
export const logout = async () => API.post("/auth/logout");
export const getMe = async () =>
  (await API.get<Envelope<{ user: StaffUser }>>("/auth/me")).data.data.user;
