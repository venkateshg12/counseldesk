import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // One self-contained file with a fixed name, runnable from a plain <script> tag.
    lib: {
      entry: "src/main.ts",
      name: "CounselDesk",
      formats: ["iife"],
      fileName: () => "counseldesk.js",
    },
    target: "es2020",
  },
});
