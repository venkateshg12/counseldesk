import { z } from "zod";
import {
  assignLeadSchema,
  availabilityUpdateSchema,
  staffAppointmentUpdateSchema,
  staffAppointmentsQuerySchema,
  handoffListQuerySchema,
  idParamSchema,
  paginationQuerySchema,
} from "@repo/types";
import { catchError } from "../utils/errors/index.js";
import { ok } from "../utils/api/index.js";
import { OK } from "../constants/http.js";
import {
  getTranscript,
  listHandoffs,
  listLeads,
  resolveHandoff,
} from "../services/staff.service.js";
import {
  assignLeadToAttorney,
  listAppointments,
  listAttorneys,
  setAvailability,
  updateAppointmentStatus,
} from "../services/staffBooking.service.js";
import { getStats, getTrace } from "../services/stats.service.js";

export const listLeadsHandler = catchError(async (req, res) => {
  const { rows, meta } = await listLeads(
    paginationQuerySchema.parse(req.query),
  );
  res.status(OK).json(ok(rows, meta));
});

export const listHandoffsHandler = catchError(async (req, res) => {
  const { rows, meta } = await listHandoffs(
    handoffListQuerySchema.parse(req.query),
  );
  res.status(OK).json(ok(rows, meta));
});

export const transcriptHandler = catchError(async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  res.status(OK).json(ok(await getTranscript(id)));
});

export const resolveHandoffHandler = catchError(async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  res.status(OK).json(ok(await resolveHandoff(id, req.userId!)));
});

const statsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});

export const statsHandler = catchError(async (req, res) => {
  const { days } = statsQuerySchema.parse(req.query);
  res.status(OK).json(ok(await getStats(days)));
});

export const traceHandler = catchError(async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  res.status(OK).json(ok(await getTrace(id)));
});

export const listAppointmentsHandler = catchError(async (req, res) => {
  const query = staffAppointmentsQuerySchema.parse(req.query);
  res.status(OK).json(ok(await listAppointments(query)));
});

export const updateAppointmentHandler = catchError(async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const { status } = staffAppointmentUpdateSchema.parse(req.body);
  await updateAppointmentStatus(id, status);
  res.status(OK).json(ok({ id, status }));
});

export const assignLeadHandler = catchError(async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const { attorneyId } = assignLeadSchema.parse(req.body);
  await assignLeadToAttorney(id, attorneyId);
  res.status(OK).json(ok({ id, attorneyId }));
});

export const listAttorneysHandler = catchError(async (_req, res) => {
  res.status(OK).json(ok(await listAttorneys()));
});

export const setAvailabilityHandler = catchError(async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const { rules } = availabilityUpdateSchema.parse(req.body);
  await setAvailability(id, rules);
  res.status(OK).json(ok({ id, rules }));
});
