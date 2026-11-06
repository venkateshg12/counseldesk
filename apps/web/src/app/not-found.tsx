import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-24">
        <h1 className="text-5xl font-normal tracking-tight">Page not found</h1>
        <p className="mt-6 text-body">
          <Link href="/" className="text-link underline underline-offset-4">
            Back to the home page
          </Link>
        </p>
      </main>
    </>
  );
}
