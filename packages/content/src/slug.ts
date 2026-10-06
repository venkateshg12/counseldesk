// "Fees for DUI cases" → "fees-for-dui-cases". Used by ingestion (anchors) and the website (heading
// ids), so both always produce the same anchor for the same heading.
export const slugify = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // accents: "é" → "e"
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");

// Per-page: the second "Hours" heading becomes "hours-2", the third "hours-3".
export const createSlugger = () => {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = slugify(text) || "section";
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };
};
