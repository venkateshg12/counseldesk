import { config } from "@repo/eslint-config/base";

export default [
  ...config,
  {
    ignores: ["migrations/**", "src/prisma/contract.d.ts"],
  },
  {
    rules: {
      // A leading underscore marks a deliberately unused name, e.g. Express's 4th error-handler argument.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
