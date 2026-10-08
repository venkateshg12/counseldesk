import Link from "next/link";

const NAV = [
  { href: "/practice-areas/dui", label: "DUI" },
  { href: "/practice-areas/family-law", label: "Family law" },
  { href: "/practice-areas/personal-injury", label: "Personal injury" },
  { href: "/fees", label: "Fees" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/90 backdrop-blur">
      <nav
        className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4"
        aria-label="Main"
      >
        <Link href="/" className="mr-auto text-lg font-bold text-teal-900">
          Harbor &amp; Vale Law
        </Link>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="text-sm text-stone-700 hover:text-teal-800"
          >
            {item.label}
          </Link>
        ))}
        <Link
          href="/free-consultation"
          className="rounded-full bg-teal-800 px-4 py-2 text-sm font-medium text-white hover:bg-teal-900"
        >
          Free consultation
        </Link>
      </nav>
    </header>
  );
}
