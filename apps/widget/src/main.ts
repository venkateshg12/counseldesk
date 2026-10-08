import { mountWidget } from "./widget";

// Read while this script is executing: afterwards document.currentScript is null. Module scripts (the
// Vite dev page) never set it, so fall back to the first tag that carries the config.
const script =
  (document.currentScript as HTMLScriptElement | null) ??
  document.querySelector<HTMLScriptElement>("script[data-api-url]");

const apiUrl = script?.dataset["apiUrl"]?.replace(/\/$/, "");
const siteUrl = script?.dataset["siteUrl"];

if (!apiUrl) {
  console.error("[counseldesk] the script tag needs data-api-url");
} else {
  const start = () =>
    mountWidget({
      apiUrl,
      siteOrigin: siteUrl ? new URL(siteUrl).origin : location.origin,
    });
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else start();
}
