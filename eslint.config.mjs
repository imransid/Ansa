import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Tenant isolation depends on every query going through /db, and there is no
// Row Level Security behind it. These rules make "a query outside /db" a lint
// error instead of a code-review catch. Outside /db:
// - drizzle-orm, pg and the raw client (@/db/client) are never imported;
// - /db is only imported statically and spelled exactly "@/db/<file>", so the
//   rules can see it: no relative or absolute path ("../db/client"), no ".",
//   ".." or "//" in it ("@/lib/../db/client"), no file extension
//   ("@/db/client.js"), no import() or require() of it;
// - app/ and components/ never import /db at all (they call /services);
// - lib/ imports nothing from /db but @/db/schema (types and constant lists),
//   except lib/auth.ts, which also hands the raw client to Better Auth;
// - nothing loads modules at run time in a way lint can't read: no
//   node:module (createRequire), no module.require, no require kept in a
//   variable;
// - Better Auth's internals (auth.$context: its internalAdapter and adapter
//   read and write the users table with no company filter) are only used in
//   lib/auth.ts and lib/password-reset-links.ts.

// Every file ESLint can read, JavaScript included (tsconfig allows it).
const sourceFiles = "*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}";

const queriesBelongInDb = "Database queries belong in /db.";
const callServicesInstead = "Call a function from /services instead.";

const queryLibraryPaths = [
  { name: "drizzle-orm", message: queriesBelongInDb },
  { name: "pg", message: queriesBelongInDb },
];
// createRequire() loads any module by a name lint never sees.
const runtimeLoadingMessage = "Load modules with a plain import, so lint can check what is loaded.";
const moduleLoaderPaths = [
  { name: "module", message: runtimeLoadingMessage },
  { name: "node:module", message: runtimeLoadingMessage },
];
const databaseImportPaths = [
  ...queryLibraryPaths,
  ...moduleLoaderPaths,
  { name: "@/db/client", message: "Call a function from /db instead of using the raw client." },
];
const databaseImportPatterns = [
  { group: ["drizzle-orm/*", "pg/*"], message: queriesBelongInDb },
  // TypeScript resolves many spellings of one /db file, but the rules here only
  // recognise the plain "@/db/<file>". So every other path into a "db" folder
  // is an error: "../db/client", "/home/me/ansa/db/client",
  // "@/lib/../db/client", "@/db/./client", "@//db/client", "@/db/client.js".
  // (A wrong case, "@/DB/client", already fails the typecheck.)
  {
    regex: "^(?!@/db/[a-z0-9-]+$)(.*/)?db(/|$)",
    message: 'Import /db exactly as "@/db/<file>": no relative or absolute path, no ".", ".." or "//", no extension.',
  },
];

// Matches drizzle-orm, pg and anything in a "db" folder, for import() and require().
// (\u002F is a slash spelled out: a selector's regex ends at the first plain one.)
const databaseModule = "/^(drizzle-orm|pg)(\\u002F|$)|(^|\\u002F)db(\\u002F|$)/";
const noDynamicDatabaseImports = [
  {
    selector: "ImportExpression[source.type!='Literal']",
    message: "Use a plain string in import(), so lint can check what is imported.",
  },
  {
    // A template string (require(`@/db/client`)) has no .value to check.
    selector: "CallExpression[callee.name='require'][arguments.0.type!='Literal']",
    message: "Use a plain string in require(), so lint can check what is required.",
  },
  {
    selector: `ImportExpression[source.value=${databaseModule}]`,
    message: "Import database code statically, and only inside /db.",
  },
  {
    selector: `CallExpression[callee.name='require'][arguments.0.value=${databaseModule}]`,
    message: "Import database code statically, and only inside /db.",
  },
  {
    selector: `TSExternalModuleReference[expression.value=${databaseModule}]`,
    message: "Import database code statically, and only inside /db.",
  },
];

// Ways to load a module that the rules above can't read.
const noRuntimeModuleLoading = [
  { selector: "Identifier[name=/^(createRequire|getBuiltinModule)$/]", message: runtimeLoadingMessage },
  // module.require("pg"), require.call(...), globalThis.require: only require("...") itself is checked.
  { selector: "MemberExpression[property.name='require']", message: runtimeLoadingMessage },
  { selector: "MemberExpression[property.value='require']", message: runtimeLoadingMessage },
  {
    // const load = require; load("pg"): require may only be called, directly.
    selector: "Identifier[name='require']:not(CallExpression > Identifier.callee):not(MemberExpression > Identifier.property):not(Property > Identifier.key)",
    message: runtimeLoadingMessage,
  },
  { selector: "ImportExpression[source.value=/^(node:)?module$/]", message: runtimeLoadingMessage },
];

// Better Auth's $context holds its raw database access: internalAdapter and
// adapter read and write the users table (a tenant table) with no company
// filter, outside /db and outside every rule above.
const betterAuthInternalsMessage = "Better Auth's $context (internalAdapter, adapter) is only used in lib/auth.ts and lib/password-reset-links.ts.";
const noBetterAuthInternals = [
  // auth.$context, and const { $context } = auth.
  { selector: "MemberExpression[property.name=/^(\\$context|internalAdapter)$/]", message: betterAuthInternalsMessage },
  { selector: "Property[key.name=/^(\\$context|internalAdapter)$/]", message: betterAuthInternalsMessage },
  // The name as a string anywhere: auth["$context"], { "$context": context },
  // { ["$context"]: context }, Reflect.get(auth, "$context"), and the same
  // with a template string.
  { selector: "Literal[value=/^(\\$context|internalAdapter)$/]", message: betterAuthInternalsMessage },
  { selector: "TemplateElement[value.cooked=/^(\\$context|internalAdapter)$/]", message: betterAuthInternalsMessage },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [`**/${sourceFiles}`],
    // scripts/ are local dev tools that clean up their own test data.
    ignores: ["db/**", "scripts/**", "drizzle.config.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: databaseImportPaths, patterns: databaseImportPatterns }],
      "no-restricted-syntax": ["error", ...noDynamicDatabaseImports, ...noRuntimeModuleLoading, ...noBetterAuthInternals],
    },
  },
  {
    // Pages, layouts, server actions and UI components call /services, never
    // /db. (A rule here replaces the one above for these files, so it repeats it.)
    files: [`app/**/${sourceFiles}`, `components/**/${sourceFiles}`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: databaseImportPaths,
          patterns: [...databaseImportPatterns, { regex: "^@/db(/|$)", message: callServicesInstead }],
        },
      ],
    },
  },
  {
    // lib/ holds shared helpers: it may use the schema's types and constant
    // lists (roles, ticket channels), but never a query function.
    files: [`lib/**/${sourceFiles}`],
    ignores: ["lib/auth.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: databaseImportPaths,
          patterns: [
            ...databaseImportPatterns,
            { regex: "^@/db(?!/schema$)(/|$)", message: "lib/ may only import @/db/schema. Queries belong in /db, called from /services." },
          ],
        },
      ],
    },
  },
  {
    // lib/auth.ts hands the raw client and the schema to Better Auth's
    // adapter, and imports nothing else from /db. (The import() and require()
    // rules of the first block still apply here.)
    files: ["lib/auth.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [...queryLibraryPaths, ...moduleLoaderPaths],
          patterns: [
            ...databaseImportPatterns,
            { regex: "^@/db/(?!(client|schema)$)", message: "lib/auth.ts may only import @/db/client and @/db/schema." },
          ],
        },
      ],
    },
  },
  {
    // The two files that wrap Better Auth's internals: lib/auth.ts (session
    // hooks, password checks) and lib/password-reset-links.ts (whose account
    // a reset link is, looked up by the link's own token). The other rules of
    // the first block still apply here.
    files: ["lib/auth.ts", "lib/password-reset-links.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...noDynamicDatabaseImports, ...noRuntimeModuleLoading],
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
