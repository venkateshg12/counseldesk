import { notFound } from "next/navigation";
import { findPage } from "@/lib/content";
import { SitePage } from "@/components/SitePage";
import { HomeLanding } from "@/components/HomeLanding";

export default function Home() {
  const page = findPage("/");
  if (!page) notFound();
  return (
    <HomeLanding title={page.title}>
      <SitePage page={page} showTitle={false} />
    </HomeLanding>
  );
}
