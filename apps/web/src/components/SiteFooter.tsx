import Link from "next/link";

const LINKS = [
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
  { href: "/what-to-expect", label: "What to expect" },
  { href: "/contact", label: "Contact" },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 bg-night text-on-night-muted">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-6 py-14 md:grid-cols-[2fr_1fr]">
        <div>
          <p className="text-2xl font-normal text-on-night">
            Harbor &amp; Vale Law
          </p>
          <p className="mt-4 max-w-xl text-sm leading-6">
            Harbor &amp; Vale Law is a fictional firm created to demonstrate the
            CounselDesk assistant. Nothing on this site is legal advice.
          </p>
        </div>
        <nav aria-label="Footer" className="text-sm">
          <ul className="space-y-2">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="transition-colors hover:text-on-night"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/privacy"
                className="underline underline-offset-2 transition-colors hover:text-on-night"
              >
                Privacy and how the website assistant works
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
