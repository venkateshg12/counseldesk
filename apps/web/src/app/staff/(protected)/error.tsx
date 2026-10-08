"use client";

export default function StaffError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 p-6"
    >
      <p className="font-semibold">Something went wrong on this page.</p>
      <p className="mt-1 text-sm text-stone-700">{error.message}</p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-lg bg-teal-800 px-3 py-1 text-white"
      >
        Try again
      </button>
    </div>
  );
}
