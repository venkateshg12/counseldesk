import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-stone-200 bg-white">
      <div className="mx-auto max-w-5xl px-6 py-8 text-sm text-stone-600">
        <p>
          Harbor &amp; Vale Law is a fictional firm created to demonstrate the
          CounselDesk assistant. Nothing on this site is legal advice.
        </p>
        <p className="mt-2">
          <Link href="/privacy" className="underline">
            Privacy and how the website assistant works
          </Link>
        </p>
      </div>
    </footer>
  );
}
