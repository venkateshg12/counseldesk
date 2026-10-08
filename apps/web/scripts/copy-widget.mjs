import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

// Copies the built widget into public/ so the site serves it at /widget/counseldesk.js.
const require = createRequire(import.meta.url);
let source;
try {
  source = require.resolve("widget/counseldesk.js");
} catch {
  console.warn(
    "[copy-widget] widget not built yet — run: pnpm --filter widget build",
  );
  process.exit(0);
}
mkdirSync("public/widget", { recursive: true });
copyFileSync(source, "public/widget/counseldesk.js");
