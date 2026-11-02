"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CASE_TYPES,
  createAppointmentSchema,
  type AppointmentMode,
  type CaseType,
  type CreatedAppointment,
  type SlotsResponse,
} from "@repo/types";
import { bookAppointment, getSlots, holdSlot } from "@/api/booking";
import { CASE_LABELS, fullLabel } from "./format";
import { SlotPicker } from "./SlotPicker";

type Hold = { startsAt: string; holdToken: string; expiresAt: string };
type Step = "type" | "slot" | "details" | "done";

const message = (error: unknown) =>
  (error as { message?: string })?.message ?? "Something went wrong.";

function Countdown({
  expiresAt,
  onExpire,
}: {
  expiresAt: string;
  onExpire: () => void;
}) {
  const [left, setLeft] = useState(() =>
    Math.max(
      0,
      Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000),
    ),
  );
  useEffect(() => {
    const timer = setInterval(() => {
      const next = Math.max(
        0,
        Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000),
      );
      setLeft(next);
      if (next === 0) onExpire();
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt, onExpire]);
  const mm = String(Math.floor(left / 60));
  const ss = String(left % 60).padStart(2, "0");
  return (
    <p className="text-sm text-muted" role="timer">
      We&apos;re holding this time for you: {mm}:{ss}
    </p>
  );
}

export function BookingFlow() {
  const [step, setStep] = useState<Step>("type");
  const [caseType, setCaseType] = useState<CaseType | null>(null);
  const [slots, setSlots] = useState<SlotsResponse | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [created, setCreated] = useState<CreatedAppointment | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSlots = async (type: CaseType) => {
    setBusy(true);
    setError(null);
    try {
      setSlots(await getSlots(type));
      setStep("slot");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseType = (type: CaseType) => {
    setCaseType(type);
    setNotice(null);
    void loadSlots(type);
  };

  const pickSlot = async (startsAt: string) => {
    if (!slots) return;
    setBusy(true);
    setError(null);
    try {
      const result = await holdSlot(slots.attorney.id, startsAt);
      setHold({ startsAt, ...result });
      setStep("details");
    } catch (e) {
      // Taken by someone else a moment ago: show fresh times.
      setNotice(message(e));
      if (caseType) await loadSlots(caseType);
    } finally {
      setBusy(false);
    }
  };

  const expireHold = () => {
    setHold(null);
    setNotice("Your reservation expired. Please pick a time again.");
    if (caseType) void loadSlots(caseType);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!slots || !hold || !caseType) return;
    const form = new FormData(event.currentTarget);
    const parsed = createAppointmentSchema.safeParse({
      name: form.get("name"),
      email: form.get("email"),
      phone: form.get("phone") || undefined,
      summary: form.get("summary") || undefined,
      mode: form.get("mode"),
      caseType,
      attorneyId: slots.attorney.id,
      startsAt: hold.startsAt,
      holdToken: hold.holdToken,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your details.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setCreated(await bookAppointment(parsed.data));
      setStep("done");
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status === 409) {
        setNotice(message(e));
        setHold(null);
        await loadSlots(caseType);
      } else {
        setError(message(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <h1 className="text-5xl font-normal leading-[1.1] tracking-tight">
        Book a free consultation
      </h1>
      <p className="mt-4 text-lg leading-[1.4] text-body">
        A free 30-minute conversation with one of our attorneys, by video or in
        person. Pick what you need help with, then choose a time.
      </p>

      {notice ? (
        <p
          role="status"
          className="mt-6 rounded-lg bg-brand/20 px-4 py-3 text-sm text-ink"
        >
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-6 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {step === "type" ? (
        <section className="mt-10" aria-label="Type of case">
          <h2 className="text-2xl font-normal">What do you need help with?</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {CASE_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                disabled={busy}
                onClick={() => chooseType(type)}
                className="rounded-lg border border-line bg-soft px-5 py-4 text-left font-normal transition-colors hover:border-brand disabled:opacity-50"
              >
                {CASE_LABELS[type]}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {step === "slot" && slots ? (
        <section className="mt-10" aria-label="Choose a time">
          <h2 className="text-2xl font-normal">
            Pick a time with {slots.attorney.name}
          </h2>
          <p className="mt-1 text-sm text-muted">All times are Arizona time.</p>
          <div className="mt-6">
            <SlotPicker
              slots={slots.slots}
              disabled={busy}
              onPick={(slot) => void pickSlot(slot.startsAt)}
            />
          </div>
          <button
            type="button"
            onClick={() => setStep("type")}
            className="mt-8 text-sm text-link underline underline-offset-4"
          >
            Change the type of case
          </button>
        </section>
      ) : null}

      {step === "details" && hold && slots ? (
        <section className="mt-10" aria-label="Your details">
          <h2 className="text-2xl font-normal">Your details</h2>
          <p className="mt-2 text-body">
            {fullLabel(hold.startsAt)} with {slots.attorney.name}
          </p>
          <Countdown expiresAt={hold.expiresAt} onExpire={expireHold} />
          <form
            onSubmit={(e) => void submit(e)}
            className="mt-6 space-y-4"
            noValidate
          >
            <label className="block">
              <span className="text-sm font-normal">Your name</span>
              <input
                name="name"
                autoComplete="name"
                required
                className="mt-1 w-full rounded-lg border border-fog bg-canvas px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm font-normal">Email</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                className="mt-1 w-full rounded-lg border border-fog bg-canvas px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm font-normal">Phone (optional)</span>
              <input
                name="phone"
                type="tel"
                autoComplete="tel"
                className="mt-1 w-full rounded-lg border border-fog bg-canvas px-3 py-2"
              />
            </label>
            <fieldset>
              <legend className="text-sm font-normal">
                How would you like to meet?
              </legend>
              <div className="mt-2 flex gap-6">
                {(
                  [
                    ["video", "By video"],
                    ["in_person", "In person"],
                  ] as [AppointmentMode, string][]
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="radio"
                      name="mode"
                      value={value}
                      defaultChecked={value === "video"}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="text-sm font-normal">
                Anything we should know? (optional)
              </span>
              <textarea
                name="summary"
                rows={3}
                maxLength={500}
                className="mt-1 w-full rounded-lg border border-fog bg-canvas px-3 py-2"
              />
            </label>
            <p className="text-xs text-muted">
              Please don&apos;t share confidential details here. This is a
              booking form, not legal advice.
            </p>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-brand px-6 py-3 font-normal text-white transition-colors hover:bg-brand-deep disabled:opacity-50"
            >
              {busy ? "Booking…" : "Confirm booking"}
            </button>
          </form>
        </section>
      ) : null}

      {step === "done" && created ? (
        <section
          className="mt-10 rounded-[14px] border border-line bg-soft p-8"
          aria-label="Booked"
        >
          <h2 className="text-3xl font-normal">You&apos;re booked</h2>
          <p className="mt-4 text-lg text-ink">{fullLabel(created.startsAt)}</p>
          <p className="mt-1 text-body">
            with {created.attorney.name},{" "}
            {created.mode === "video" ? "by video" : "in person"}
          </p>
          <p className="mt-4 text-sm text-muted">
            We&apos;ve emailed you a confirmation with a calendar invite. Need
            to change it?
          </p>
          <Link
            href={`/book/manage/${created.id}?token=${encodeURIComponent(created.manageToken)}`}
            className="mt-3 inline-block text-link underline underline-offset-4"
          >
            Reschedule or cancel
          </Link>
        </section>
      ) : null}
    </div>
  );
}
