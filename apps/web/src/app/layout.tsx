import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Harbor & Vale Law", template: "%s · Harbor & Vale Law" },
  description:
    "A fictional law firm in Phoenix, Arizona — the demo site for the CounselDesk assistant.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        {children}
      </body>
    </html>
  );
}
