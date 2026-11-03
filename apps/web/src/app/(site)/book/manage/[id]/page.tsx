import type { Metadata } from "next";
import { Suspense } from "react";
import { ManageBooking } from "@/components/booking/ManageBooking";

export const metadata: Metadata = {
  title: "Your consultation",
  robots: { index: false },
  // The address carries a secret link token: never send it on as a referrer.
  referrer: "no-referrer",
};

export default function ManageBookingPage() {
  return (
    <Suspense fallback={<p className="p-8 text-muted">Loading…</p>}>
      <ManageBooking />
    </Suspense>
  );
}
