"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MIN_PASSWORD_LENGTH, staffResetPasswordSchema } from "@repo/types";
import { useResetPassword } from "@/hooks/auth/useResetPassword";

const PATH = "/staff/reset-password";

function ResetForm() {
  const searchParams = useSearchParams();
  // Read once and kept in state, so the secret can be taken out of the address bar below.
  const [token] = useState(() => searchParams.get("token") ?? "");
  const resetMutation = useResetPassword();
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    // Out of the address bar, history and screen shares as soon as the page has it.
    window.history.replaceState(null, "", PATH);
  }, []);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = staffResetPasswordSchema.safeParse({
      token,
      password: form.get("password"),
      confirmPassword: form.get("confirmPassword"),
    });
    if (!parsed.success) {
      setFormError(
        parsed.error.issues[0]?.message ?? "Check the password and try again.",
      );
      return;
    }
    setFormError(null);
    resetMutation.mutate(parsed.data);
  };

  if (!token) {
    return (
      <div className="mt-6 space-y-4">
        <p role="alert" className="text-sm text-red-700">
          This reset link is missing or incomplete.
        </p>
        <Link href="/staff/forgot-password" className="text-sm underline">
          Request a new link
        </Link>
      </div>
    );
  }

  if (resetMutation.isSuccess) {
    return (
      <div className="mt-6 space-y-4" role="status">
        <p className="text-sm text-stone-700">{resetMutation.data}</p>
        <Link
          href="/staff/login"
          className="block w-full rounded-lg bg-teal-800 py-2 text-center font-medium text-white"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  const error =
    formError ?? (resetMutation.error as { message?: string } | null)?.message;

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
      <div>
        <label className="block">
          <span className="text-sm font-medium">New password</span>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            aria-describedby="password-hint"
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
          />
        </label>
        <span id="password-hint" className="mt-1 block text-xs text-stone-600">
          At least {MIN_PASSWORD_LENGTH} characters.
        </span>
      </div>
      <label className="block">
        <span className="text-sm font-medium">Confirm new password</span>
        <input
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {resetMutation.isError ? (
        <p className="text-sm">
          <Link href="/staff/forgot-password" className="underline">
            Request a new link
          </Link>
        </p>
      ) : null}
      <button
        type="submit"
        disabled={resetMutation.isPending}
        className="w-full rounded-lg bg-teal-800 py-2 font-medium text-white disabled:opacity-50"
      >
        {resetMutation.isPending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto mt-24 max-w-sm px-6">
      <h1 className="text-2xl font-bold">Choose a new password</h1>
      <Suspense
        fallback={<p className="mt-6 text-sm text-stone-600">Loading…</p>}
      >
        <ResetForm />
      </Suspense>
    </main>
  );
}
