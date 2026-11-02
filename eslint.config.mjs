import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// The screens never touch the database: every read and write goes through
// the Go core's API (lib/core-api.ts), where tenant isolation lives
// (core/internal/database). These rules make "the screens reach the database"
// a lint error instead of a code-review catch:
// - drizzle-orm, pg and anything under @/db are never imported, except the
//   Drizzle schema's types (lib/types/ describes core's answers with them);
// - nothing is loaded in a way lint can't read: no import() or require() of
//   those, no node:module (createRequire), no module.require, no require kept
//   in a variable.
// db/ itself (the schema and its migrations, run by drizzle-kit) and the
// screens' own checks (scripts/) are left out.

// Every file ESLint can read, JavaScript included (tsconfig allows it).
const sourceFiles = "*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}";

const throughCore = "The screens never touch the database: ask core through lib/core-api.ts.";
const runtimeLoadingMessage = "Load modules with a plain import, so lint can check what is loaded.";

const forbiddenPaths = [
  { name: "drizzle-orm", message: throughCore },
  { name: "pg", message: throughCore },
  { name: "module", message: runtimeLoadingMessage },
  { name: "node:module", message: runtimeLoadingMessage },
];
const forbiddenPatterns = [
  { group: ["drizzle-orm/*", "pg/*"], message: throughCore },
  // @/db/schema only (types); never a relative or odd path into db/.
  { regex: "^@/db(?!/schema(/[a-z-]+)?$)(/|$)", message: throughCore },
  { regex: "(^|/)\\.\\./(\\.\\./)*db(/|$)|^/.*/db(/|$)", message: throughCore },
];

const databaseModule = "/^(drizzle-orm|pg)(\\u002F|$)|(^|\\u002F)db(\\u002F|$)/";
const noHiddenLoading = [
  { selector: `ImportExpression[source.value=${databaseModule}]`, message: throughCore },
  { selector: `CallExpression[callee.name='require'][arguments.0.value=${databaseModule}]`, message: throughCore },
  { selector: "Identifier[name=/^(createRequire|getBuiltinModule)$/]", message: runtimeLoadingMessage },
  { selector: "MemberExpression[property.name='require']", message: runtimeLoadingMessage },
  { selector: "MemberExpression[property.value='require']", message: runtimeLoadingMessage },
  { selector: "VariableDeclarator[init.name='require']", message: runtimeLoadingMessage },
  { selector: "AssignmentExpression[right.name='require']", message: runtimeLoadingMessage },
  { selector: "ImportExpression[source.value=/^(node:)?module$/]", message: runtimeLoadingMessage },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [`**/${sourceFiles}`],
    ignores: ["db/**", "scripts/**", "drizzle.config.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: forbiddenPaths, patterns: forbiddenPatterns }],
      "no-restricted-syntax": ["error", ...noHiddenLoading],
      // An import used only as a type says so (erased at build time).
      "@typescript-eslint/consistent-type-imports": "error",
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
