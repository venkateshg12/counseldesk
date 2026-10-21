import type { Metadata } from "next";
import { Providers } from "@/components/staff/Providers";

export const metadata: Metadata = {
  title: "Staff",
  robots: { index: false },
  // Password-reset links carry a secret in the address; never send it on as a referrer.
  referrer: "no-referrer",
};

export default function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Providers>{children}</Providers>;
}
