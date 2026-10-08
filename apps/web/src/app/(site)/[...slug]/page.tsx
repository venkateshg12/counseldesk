import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { allPages, findPage, toSlug } from "@/lib/content";
import { SitePage } from "@/components/SitePage";

// Only the pages that exist; anything else is a 404 rather than rendered on demand.
export const dynamicParams = false;

export function generateStaticParams() {
  return allPages()
    .filter((page) => page.path !== "/")
    .map((page) => ({ slug: toSlug(page.path) }));
}

type Props = { params: Promise<{ slug: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = findPage(`/${slug.join("/")}`);
  if (!page) return {};
  const firstParagraph = page.markdown
    .replace(/^# .*\n+/m, "")
    .trim()
    .split("\n\n")[0]
    ?.replace(/[#*_`]/g, "")
    .trim();
  return {
    title: page.title,
    description: firstParagraph || undefined,
  };
}

export default async function ContentPage({ params }: Props) {
  const { slug } = await params;
  const page = findPage(`/${slug.join("/")}`);
  if (!page) notFound();
  return <SitePage page={page} />;
}
