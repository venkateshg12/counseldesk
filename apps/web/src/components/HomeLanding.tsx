import Link from "next/link";
import { Decor } from "./Decor";

/*
  The landing page, in the DESIGN-krepling.md style: white canvas, black type at one weight, hairline
  cards, 3D pastel objects as the only colour, and one violet action.
  Every claim below comes from the firm's own pages (fees, attorneys, locations, FAQ), so the chat
  assistant and the page never disagree.
 */

const FACTS = [
  { big: "Free", small: "first 30-minute consultation, in person or by video" },
  { big: "$2,500", small: "flat fee, starting price for a first-offense DUI" },
  { big: "No fee", small: "in injury cases unless we recover money for you" },
  { big: "2 offices", small: "in Phoenix and Mesa, Arizona" },
];

const AREAS = [
  {
    href: "/practice-areas/dui",
    title: "DUI defense",
    blurb: "Protecting your license and your record after an arrest.",
  },
  {
    href: "/practice-areas/criminal-defense",
    title: "Criminal defense",
    blurb: "Careful preparation, from the first hearing to trial.",
  },
  {
    href: "/practice-areas/family-law",
    title: "Family law",
    blurb: "Divorce, custody and support, handled with care.",
  },
  {
    href: "/practice-areas/personal-injury",
    title: "Personal injury",
    blurb: "Recovering fairly after an accident that wasn't your fault.",
  },
  {
    href: "/practice-areas/estate-planning",
    title: "Estate planning",
    blurb: "Wills, trusts and powers of attorney, explained simply.",
  },
];

const STEPS = [
  {
    title: "Book a free consultation",
    text: "Choose what you need help with and pick a time online. You get a confirmation and a calendar invite by email.",
  },
  {
    title: "Talk to an attorney",
    text: "In 30 minutes, an attorney listens, explains your options in plain words and answers your first questions.",
  },
  {
    title: "Decide with a clear fee",
    text: "We explain our fee before any work starts, in writing. Nothing is hidden and nothing is a surprise.",
  },
];

const ATTORNEYS = [
  {
    href: "/attorneys/elena-ruiz",
    name: "Elena Ruiz",
    focus: "DUI and criminal defense",
    note: "14 years of courtroom experience in Arizona.",
  },
  {
    href: "/attorneys/marcus-chen",
    name: "Marcus Chen",
    focus: "Family law and mediation",
    note: "More than a decade of family law in Maricopa County.",
  },
  {
    href: "/attorneys/priya-nair",
    name: "Priya Nair",
    focus: "Personal injury and estate planning",
    note: "Over eleven years of experience.",
  },
];

const FAQ = [
  {
    q: "Is the first consultation really free?",
    a: "Yes. It lasts 30 minutes and you can meet in person or by video. You can talk about your problem before you spend any money.",
  },
  {
    q: "How do you charge?",
    a: "Most criminal and DUI cases are a flat fee. Injury cases are on contingency, so you pay nothing unless we recover money. Family law and estate planning are usually billed by the hour, with an estimate up front.",
  },
  {
    q: "Which cases do you not take?",
    a: "We don't handle immigration, bankruptcy, tax or patent matters. We are happy to refer you to another firm.",
  },
];

const card = "rounded-lg border border-line bg-canvas p-6";

export function HomeLanding({
  title,
  children,
}: {
  title: string;
  // The firm's own home-page copy, rendered from markdown (it is what the assistant cites).
  children: React.ReactNode;
}) {
  return (
    <>
      <section className="mx-auto max-w-[1200px] px-6 pt-14 pb-20 md:pt-20">
        <div className="grid gap-10 md:grid-cols-[1fr_520px] md:items-start">
          <h1
            id="overview"
            className="text-6xl leading-[1.1] text-ink md:text-[80px]"
          >
            {title}
          </h1>
          <div>
            <Decor className="pointer-events-none mx-auto w-full max-w-[420px] md:max-w-none" />
            <div className="mt-6 md:ml-auto md:max-w-[340px] md:text-right">
              <p className="text-lg leading-[1.3] text-ink">
                Clear, honest legal help in Phoenix and Mesa, with direct access
                to your attorney at every step.
              </p>
              <Link
                href="/book"
                className="mt-6 inline-block rounded-lg bg-brand px-5 py-3.5 text-lg text-white transition-colors hover:bg-brand-deep"
              >
                Book a free consultation
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section
        aria-label="At a glance"
        className="mx-auto grid max-w-[1200px] gap-4 px-6 sm:grid-cols-2 lg:grid-cols-4"
      >
        {FACTS.map((fact) => (
          <div key={fact.big} className={card}>
            <p className="text-5xl leading-[1.2] text-ink">{fact.big}</p>
            <p className="mt-2 text-base leading-[1.3] text-muted">
              {fact.small}
            </p>
          </div>
        ))}
      </section>

      <section
        aria-label="Practice areas"
        className="mx-auto max-w-[1200px] px-6 pt-20"
      >
        <h2 className="text-4xl leading-[1.2] text-ink md:text-5xl">
          Practice areas
        </h2>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {AREAS.map((area) => (
            <li key={area.href}>
              <Link
                href={area.href}
                className={`${card} flex h-full flex-col transition-colors hover:bg-soft`}
              >
                <span className="text-2xl leading-[1.2] text-ink">
                  {area.title}
                </span>
                <span className="mt-2 text-base leading-[1.3] text-muted">
                  {area.blurb}
                </span>
                <span className="mt-5 text-base text-link">Learn more →</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label="How it works"
        className="mx-auto max-w-[1200px] px-6 pt-20"
      >
        <h2 className="text-4xl leading-[1.2] text-ink md:text-5xl">
          How it works
        </h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className={card}>
              <span className="text-sm text-muted">Step {index + 1}</span>
              <h3 className="mt-3 text-2xl leading-[1.2] text-ink">
                {step.title}
              </h3>
              <p className="mt-2 text-base leading-[1.3] text-ink">
                {step.text}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section
        aria-label="Our attorneys"
        className="mx-auto max-w-[1200px] px-6 pt-20"
      >
        <h2 className="text-4xl leading-[1.2] text-ink md:text-5xl">
          Meet the attorneys
        </h2>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {ATTORNEYS.map((a) => (
            <li key={a.href}>
              <Link
                href={a.href}
                className={`${card} block h-full transition-colors hover:bg-soft`}
              >
                <span className="text-2xl leading-[1.2] text-ink">
                  {a.name}
                </span>
                <span className="mt-1 block text-base text-link">
                  {a.focus}
                </span>
                <span className="mt-3 block text-base leading-[1.3] text-muted">
                  {a.note}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label="Common questions"
        className="mx-auto max-w-[1200px] px-6 pt-20"
      >
        <h2 className="text-4xl leading-[1.2] text-ink md:text-5xl">
          Common questions
        </h2>
        <div className="mt-8 max-w-[800px] border-t border-ink">
          {FAQ.map((item) => (
            <details key={item.q} className="group border-b border-ink py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-lg text-ink marker:hidden [&::-webkit-details-marker]:hidden">
                {item.q}
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  className="size-5 shrink-0 transition-transform group-open:rotate-180"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M4 7.5 10 13.5 16 7.5" />
                </svg>
              </summary>
              <p className="mt-3 text-base leading-[1.4] text-muted">
                {item.a}
              </p>
            </details>
          ))}
        </div>
        <p className="mt-6 text-base text-muted">
          More in the{" "}
          <Link href="/faq" className="text-link underline underline-offset-4">
            full FAQ
          </Link>
          , or ask the chat assistant in the corner. It answers from this
          website and shows its sources. It does not give legal advice.
        </p>
      </section>

      {children}

      <section
        aria-label="Book a consultation"
        className="mx-auto max-w-[1200px] px-6 pt-8"
      >
        <div className="relative overflow-hidden rounded-[14px] bg-soft px-8 py-16 md:px-16">
          <Decor
            variant="small"
            className="pointer-events-none absolute top-1/2 right-6 hidden w-[360px] -translate-y-1/2 md:block"
          />
          <h2 className="relative max-w-xl text-4xl leading-[1.2] text-ink md:text-5xl">
            Ready when you are
          </h2>
          <p className="relative mt-4 max-w-[440px] text-lg leading-[1.3] text-ink">
            Your first 30-minute consultation is free. Pick a time that suits
            you.
          </p>
          <Link
            href="/book"
            className="relative mt-8 inline-block rounded-lg bg-brand px-5 py-3.5 text-lg text-white transition-colors hover:bg-brand-deep"
          >
            Book a free consultation
          </Link>
        </div>
      </section>
    </>
  );
}
