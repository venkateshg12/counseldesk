import { idParamSchema } from "@repo/types";

// Phase 00 only proves the wiring: an ESM app importing the built shared package.
// Phase 01 replaces this file with the real server.
const valid = idParamSchema.safeParse({
  id: "3f2c6c1e-8a51-4f3e-9b7a-2d4f1c0e5a77",
});
const invalid = idParamSchema.safeParse({ id: "not-a-uuid" });

console.log(
  `[api] skeleton ok - valid uuid: ${valid.success}, invalid uuid: ${invalid.success}`,
);
