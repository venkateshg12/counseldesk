"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { staffLoginSchema } from "@repo/types";
import { useLogin } from "@/hooks/auth/useLogin";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const loginMutation = useLogin();
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = staffLoginSchema.safeParse({
      email: form.get("email"),
      password: form.get("password"),
    });
    if (!parsed.success) {
      setFormError(
        parsed.error.issues[0]?.message ?? "Check your email and password.",
      );
      return;
    }
    setFormError(null);
    loginMutation.mutate(parsed.data, {
      // Only same-site relative paths are honoured, so ?next= can't send someone to another site.
      onSuccess: () =>
        router.replace(next?.startsWith("/staff") ? next : "/staff/leads"),
    });
  };

  const error =
    formError ?? (loginMutation.error as { message?: string } | null)?.message;

  return (
    <main className="mx-auto mt-24 max-w-sm px-6">
      <h1 className="text-2xl font-bold">Staff sign in</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={loginMutation.isPending}
          className="w-full rounded-lg bg-teal-800 py-2 font-medium text-white disabled:opacity-50"
        >
          {loginMutation.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto mt-24 max-w-sm px-6">
          <h1 className="text-2xl font-bold">Staff sign in</h1>
          <p className="mt-6 text-sm text-stone-600">Loading…</p>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
