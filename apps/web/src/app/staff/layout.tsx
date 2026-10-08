import type { Metadata } from "next";
import { Providers } from "@/components/staff/Providers";

export const metadata: Metadata = { title: "Staff", robots: { index: false } };

export default function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Providers>{children}</Providers>;
}
