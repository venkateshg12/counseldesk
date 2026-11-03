"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import type { AppointmentView, SlotsResponse } from "@repo/types";
import {
  cancelAppointment,
  getAppointment,
  getSlots,
  holdSlot,
  rescheduleAppointment,
} from "@/api/booking";
import { CASE_LABELS, fullLabel } from "./format";
import { SlotPicker } from "./SlotPicker";

const message = (error: unknown) =>
  (error as { message?: string })?.message ?? "Something went wrong.";

export function ManageBooking() {
  const { id } = useParams<{ id: string }>();
  const token = useSearchParams().get("token") ?? "";
  const [view, setView] = useState<AppointmentView | null>(null);
  const [slots, setSlots] = useState<SlotsResponse | null>(null);
  const [mode, setMode] = useState<"view" | "reschedule" | "cancelled">("view");
  const [token2, setToken] = useState(token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getAppointment(id, token)
      .then((appointment) => live && setView(appointment))
      .catch((e: unknown) => live && setError(message(e)));
    return () => {
      live = false;
    };
  }, [id, token]);

  const startReschedule = async () => {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      setSlots(await getSlots(view.caseType, view.attorney.id));
      setMode("reschedule");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const pick = async (startsAt: string) => {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      const { holdToken } = await holdSlot(view.attorney.id, startsAt);
      const moved = await rescheduleAppointment(id, token2, {
        startsAt,
        holdToken,
      });
      // The old link is dead now; the new one comes back with the appointment.
      setToken(moved.manageToken);
      setView(moved);
      setMode("view");
      setNotice(
        "Your consultation has been moved. We've emailed you the new time.",
      );
    } catch (e) {
      setError(message(e));
      if ((e as { status?: number })?.status === 409)
        setSlots(await getSlots(view.caseType, view.attorney.id));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!window.confirm("Cancel this consultation?")) return;
    setBusy(true);
    setError(null);
    try {
      await cancelAppointment(id, token2);
      setMode("cancelled");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <h1 className="text-5xl font-normal leading-[1.1] tracking-tight">
        Your consultation
      </h1>

      {error ? (
        <p role="alert" className="mt-6 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="mt-6 rounded-lg bg-brand/20 px-4 py-3 text-sm"
        >
          {notice}
        </p>
      ) : null}

      {mode === "cancelled" ? (
        <section className="mt-8">
          <p className="text-lg">Your consultation has been cancelled.</p>
          <Link
            href="/book"
            className="mt-3 inline-block text-link underline underline-offset-4"
          >
            Book a new time
          </Link>
        </section>
      ) : null}

      {view && mode === "view" ? (
        <section className="mt-8 rounded-[14px] border border-line bg-soft p-8">
          <p className="text-lg text-ink">{fullLabel(view.startsAt)}</p>
          <p className="mt-1 text-body">
            with {view.attorney.name} ·{" "}
            {view.mode === "video" ? "by video" : "in person"} ·{" "}
            {CASE_LABELS[view.caseType]}
          </p>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void startReschedule()}
              className="rounded-lg bg-brand px-5 py-2.5 font-normal text-white transition-colors hover:bg-brand-deep disabled:opacity-50"
            >
              Reschedule
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void cancel()}
              className="rounded-lg border-[1.5px] border-brand bg-canvas px-5 py-2.5 text-link font-normal transition-colors hover:bg-card disabled:opacity-50"
            >
              Cancel consultation
            </button>
          </div>
        </section>
      ) : null}

      {mode === "reschedule" && slots ? (
        <section className="mt-8" aria-label="Choose a new time">
          <h2 className="text-2xl font-normal">Pick a new time</h2>
          <p className="mt-1 text-sm text-muted">All times are Arizona time.</p>
          <div className="mt-6">
            <SlotPicker
              slots={slots.slots}
              disabled={busy}
              onPick={(s) => void pick(s.startsAt)}
            />
          </div>
          <button
            type="button"
            onClick={() => setMode("view")}
            className="mt-8 text-sm text-link underline underline-offset-4"
          >
            Keep my current time
          </button>
        </section>
      ) : null}
    </div>
  );
}
