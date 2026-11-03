import Link from "next/link";

// Closes every content page with the next step, so no page is a dead end.
export function BookCta() {
  return (
    <aside
      aria-label="Free consultation"
      className="mx-auto mt-4 max-w-3xl px-6"
    >
      <div className="rounded-[14px] bg-soft p-8">
        <h2 className="text-2xl font-normal ">Ready to talk to someone?</h2>
        <p className="mt-2 text-body">
          Your first 30-minute consultation is free. Pick a time that suits you.
        </p>
        <Link
          href="/book"
          className="mt-5 inline-block rounded-lg bg-brand px-5 py-2.5 font-normal text-white transition-colors hover:bg-brand-deep"
        >
          Book a free consultation
        </Link>
      </div>
    </aside>
  );
}
