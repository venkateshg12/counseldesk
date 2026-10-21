"use client";

import { useState } from "react";
import Link from "next/link";
import { staffForgotPasswordSchema } from "@repo/types";
import { useForgotPassword } from "@/hooks/auth/useForgotPassword";

export default function ForgotPasswordPage() {
  const forgotMutation = useForgotPassword();
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = staffForgotPasswordSchema.safeParse({
      email: new FormData(event.currentTarget).get("email"),
    });
    if (!parsed.success) {
      setFormError(
        parsed.error.issues[0]?.message ?? "Enter a valid email address.",
      );
      return;
    }
    setFormError(null);
    forgotMutation.mutate(parsed.data);
  };

  const error =
    formError ?? (forgotMutation.error as { message?: string } | null)?.message;

  return (
    <main className="mx-auto mt-24 max-w-sm px-6">
      <h1 className="text-2xl font-bold">Reset your password</h1>
      {forgotMutation.isSuccess ? (
        <div className="mt-6 space-y-4" role="status">
          <p className="text-sm text-stone-700">{forgotMutation.data}</p>
          <p className="text-sm">
            <Link href="/staff/login" className="underline">
              Back to sign in
            </Link>
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <p className="text-sm text-stone-600">
            Enter your staff email and we&apos;ll send you a link to choose a
            new password.
          </p>
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
          {error ? (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={forgotMutation.isPending}
            className="w-full rounded-lg bg-teal-800 py-2 font-medium text-white disabled:opacity-50"
          >
            {forgotMutation.isPending ? "Sending…" : "Send reset link"}
          </button>
          <p className="text-sm">
            <Link href="/staff/login" className="underline">
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </main>
  );
}
