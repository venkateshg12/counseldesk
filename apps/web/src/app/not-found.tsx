import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-24">
        <h1 className="text-3xl font-bold">Page not found</h1>
        <p className="mt-4 text-stone-700">
          <Link href="/" className="underline">
            Back to the home page
          </Link>
        </p>
      </main>
    </>
  );
}
