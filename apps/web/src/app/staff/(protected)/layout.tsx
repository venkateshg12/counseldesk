"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMe } from "@/hooks/auth/useMe";
import { useLogout } from "@/hooks/auth/useLogout";

const NAV = [
  { href: "/staff/leads", label: "Leads" },
  { href: "/staff/appointments", label: "Appointments" },
  { href: "/staff/handoffs", label: "Needs a human" },
  { href: "/staff/attorneys", label: "Attorneys" },
  { href: "/staff/metrics", label: "Metrics" },
];

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const logoutMutation = useLogout();

  useEffect(() => {
    if (me.isError) {
      router.replace(`/staff/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [me.isError, router, pathname]);

  if (!me.data) {
    return (
      <p className="p-8 text-muted">
        {me.isError ? "Redirecting to sign in…" : "Checking your session…"}
      </p>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-canvas">
        <nav
          className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3"
          aria-label="Staff"
        >
          <span className="text-lg font-normal text-ink">
            CounselDesk · Staff
          </span>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname.startsWith(item.href) ? "page" : undefined}
              className="text-sm text-body transition-colors hover:text-link aria-[current=page]:font-normal aria-[current=page]:text-link"
            >
              {item.label}
            </Link>
          ))}
          <span className="ml-auto text-sm text-muted">{me.data.name}</span>
          <button
            type="button"
            onClick={() => logoutMutation.mutate()}
            className="text-sm underline"
          >
            Sign out
          </button>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
