import Script from "next/script";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
      <Script
        src="/widget/counseldesk.js"
        data-api-url={process.env.NEXT_PUBLIC_API_URL}
        strategy="afterInteractive"
      />
    </>
  );
}
