import { notFound } from "next/navigation";
import { findPage } from "@/lib/content";
import { SitePage } from "@/components/SitePage";

export default function Home() {
  const page = findPage("/");
  if (!page) notFound();
  return <SitePage page={page} />;
}
