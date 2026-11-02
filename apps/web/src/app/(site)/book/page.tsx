import type { Metadata } from "next";
import { BookingFlow } from "@/components/booking/BookingFlow";

export const metadata: Metadata = {
  title: "Book a free consultation",
  description:
    "Pick a time for a free 30-minute consultation with a Harbor & Vale Law attorney.",
};

export default function BookPage() {
  return <BookingFlow />;
}
