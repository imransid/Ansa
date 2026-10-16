import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Tenant isolation depends on every query going through /db.
// These rules make "a query outside /db" a lint error instead of a code-review catch.
const databaseImportsOnlyInDb = [
  { name: "drizzle-orm", message: "Database queries belong in /db." },
  { name: "pg", message: "Database queries belong in /db." },
  {
    name: "@/db/client",
    message: "Call a function from /db instead of using the raw client.",
  },
];
const drizzleSubpathsOnlyInDb = {
  group: ["drizzle-orm/*"],
  message: "Database queries belong in /db.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx}"],
    // lib/auth.ts hands the client to Better Auth's adapter.
    // scripts/ are local dev tools that clean up their own test data.
    ignores: ["db/**", "lib/auth.ts", "scripts/**", "drizzle.config.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: databaseImportsOnlyInDb,
          patterns: [drizzleSubpathsOnlyInDb],
        },
      ],
    },
  },
  {
    // Pages, layouts and server actions call /services, never /db directly.
    files: ["app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: databaseImportsOnlyInDb,
          patterns: [
            drizzleSubpathsOnlyInDb,
            {
              group: ["@/db", "@/db/*"],
              message: "Call a function from /services instead.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
