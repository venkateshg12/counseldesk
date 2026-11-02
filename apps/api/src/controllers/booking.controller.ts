import {
  createAppointmentSchema,
  holdRequestSchema,
  idParamSchema,
  manageTokenQuerySchema,
  rescheduleSchema,
  slotsQuerySchema,
} from "@repo/types";
import { catchError } from "../utils/errors/index.js";
import { ok } from "../utils/api/index.js";
import { CREATED, OK } from "../constants/http.js";
import {
  cancelByToken,
  createAppointment,
  createHold,
  getAppointmentByToken,
  listSlots,
  rescheduleByToken,
} from "../services/booking.service.js";

export const listSlotsHandler = catchError(async (req, res) => {
  const { caseType, attorneyId } = slotsQuerySchema.parse(req.query);
  res.status(OK).json(ok(await listSlots(caseType, attorneyId)));
});

export const createHoldHandler = catchError(async (req, res) => {
  const { attorneyId, startsAt } = holdRequestSchema.parse(req.body);
  res.status(CREATED).json(ok(await createHold(attorneyId, startsAt)));
});

export const createAppointmentHandler = catchError(async (req, res) => {
  const input = createAppointmentSchema.parse(req.body);
  res.status(CREATED).json(ok(await createAppointment(input)));
});

export const getAppointmentHandler = catchError(async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const { token } = manageTokenQuerySchema.parse(req.query);
  res.status(OK).json(ok(await getAppointmentByToken(id, token)));
});

export const cancelAppointmentHandler = catchError(async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const { token } = manageTokenQuerySchema.parse(req.query);
  await cancelByToken(id, token);
  res.status(OK).json(ok({ cancelled: true }));
});

export const rescheduleAppointmentHandler = catchError(async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const { token } = manageTokenQuerySchema.parse(req.query);
  const body = rescheduleSchema.parse(req.body);
  res.status(OK).json(ok(await rescheduleByToken(id, token, body)));
});
