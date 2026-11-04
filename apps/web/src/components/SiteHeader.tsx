import Link from "next/link";

const NAV = [
  { href: "/practice-areas/dui", label: "DUI" },
  { href: "/practice-areas/family-law", label: "Family law" },
  { href: "/practice-areas/personal-injury", label: "Personal injury" },
  { href: "/fees", label: "Fees" },
  { href: "/contact", label: "Contact" },
];

// White bar with a hairline, plain text links, and the outlined-violet action on the right.
export function SiteHeader() {
  return (
    <header className="border-b border-line bg-canvas">
      <nav
        className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-7 gap-y-2 px-6 py-5"
        aria-label="Main"
      >
        <Link href="/" className="mr-auto text-xl tracking-[0.01em] text-ink">
          Harbor &amp; Vale Law
        </Link>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="text-base text-ink transition-colors hover:text-link hover:underline underline-offset-4"
          >
            {item.label}
          </Link>
        ))}
        <Link
          href="/book"
          className="rounded-lg border-[1.5px] border-brand bg-canvas px-5 py-3 text-base text-link transition-colors hover:bg-soft"
        >
          Free consultation
        </Link>
      </nav>
    </header>
  );
}
