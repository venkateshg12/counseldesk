import { Router } from "express";
import {
  bookingSlotsLimiter,
  bookingWriteLimiter,
} from "../config/rateLimiter.js";
import {
  cancelAppointmentHandler,
  createAppointmentHandler,
  createHoldHandler,
  getAppointmentHandler,
  listSlotsHandler,
  rescheduleAppointmentHandler,
} from "../controllers/booking.controller.js";

export const bookingRoutes = Router();

// prefix: /booking  (public: visitors have no account; manage links carry a signed token)
bookingRoutes.get("/slots", bookingSlotsLimiter, listSlotsHandler);
bookingRoutes.post("/holds", bookingWriteLimiter, createHoldHandler);
bookingRoutes.post(
  "/appointments",
  bookingWriteLimiter,
  createAppointmentHandler,
);
bookingRoutes.get(
  "/appointments/:id",
  bookingSlotsLimiter,
  getAppointmentHandler,
);
bookingRoutes.post(
  "/appointments/:id/cancel",
  bookingWriteLimiter,
  cancelAppointmentHandler,
);
bookingRoutes.post(
  "/appointments/:id/reschedule",
  bookingWriteLimiter,
  rescheduleAppointmentHandler,
);
