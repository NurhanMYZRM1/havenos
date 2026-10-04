// ESLint reads the code and flags likely bugs before they ship.
// Run it with `npm run lint`. The rules come from Next.js's own config:
// React, React Hooks, accessibility, Next.js pitfalls, and TypeScript.
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  // Build output, native mobile projects and generated files are never linted.
  {
    ignores: [
      ".next/**",
      "out/**",
      "dist-desktop/**",
      "release/**",
      "android/**",
      "ios/**",
      "next-env.d.ts",
      "lib/database.types.ts",
      // The Expo app has its own toolchain (cd mobile && npm run typecheck).
      "mobile/**",
    ],
  },
  {
    rules: {
      // A leading underscore marks a value that is deliberately unused
      // (for example `{ key: _key, ...row }` to drop one field).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
      // Screens reset and reload their data in an effect when the selected
      // record changes. That works correctly, so this performance advice is a
      // warning (shown, but not a CI failure) until those screens are refactored.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default eslintConfig;
