export function QueryState({
  isPending,
  error,
  isEmpty,
  emptyText,
}: {
  isPending: boolean;
  error: unknown;
  isEmpty: boolean;
  emptyText: string;
}) {
  if (isPending) return <p className="text-stone-600">Loading…</p>;
  if (error)
    return (
      <p role="alert" className="text-red-700">
        {(error as { message?: string }).message ?? "Couldn't load this."}
      </p>
    );
  if (isEmpty) return <p className="text-stone-600">{emptyText}</p>;
  return null;
}
