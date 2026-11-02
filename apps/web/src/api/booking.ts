import type {
  AppointmentMode,
  AppointmentView,
  CaseType,
  CreatedAppointment,
  SlotsResponse,
} from "@repo/types";
import API from "@/lib/api";

type Envelope<T> = { status: "success"; data: T };

export const getSlots = async (caseType: CaseType, attorneyId?: string) =>
  (
    await API.get<Envelope<SlotsResponse>>("/booking/slots", {
      params: { caseType, attorneyId },
    })
  ).data.data;

export const holdSlot = async (attorneyId: string, startsAt: string) =>
  (
    await API.post<Envelope<{ holdToken: string; expiresAt: string }>>(
      "/booking/holds",
      { attorneyId, startsAt },
    )
  ).data.data;

export type NewAppointment = {
  name: string;
  email: string;
  phone?: string;
  summary?: string;
  mode: AppointmentMode;
  caseType: CaseType;
  attorneyId: string;
  startsAt: string;
  holdToken: string;
};

export const bookAppointment = async (input: NewAppointment) =>
  (await API.post<Envelope<CreatedAppointment>>("/booking/appointments", input))
    .data.data;

export const getAppointment = async (id: string, token: string) =>
  (
    await API.get<Envelope<AppointmentView>>(`/booking/appointments/${id}`, {
      params: { token },
    })
  ).data.data;

export const cancelAppointment = async (id: string, token: string) =>
  API.post(`/booking/appointments/${id}/cancel`, null, { params: { token } });

export const rescheduleAppointment = async (
  id: string,
  token: string,
  body: { startsAt: string; holdToken: string },
) =>
  (
    await API.post<Envelope<CreatedAppointment>>(
      `/booking/appointments/${id}/reschedule`,
      body,
      { params: { token } },
    )
  ).data.data;
