import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Krepling is a single-weight (400) system; Inter is its listed free substitute.
const sans = Inter({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-inter",
  display: "swap",
});

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
    <html lang="en" className={sans.variable}>
      <body className="min-h-screen bg-canvas font-sans text-body antialiased">
        {children}
      </body>
    </html>
  );
}
