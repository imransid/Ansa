// Docs checks (step 43), on the docs and the code together: .env.example and
// docs/going-live.md name every setting lib/env.ts reads (and .env.example no
// other), the README names every package script, every file the docs name
// exists, every database dump they tell the operator to make is written
// outside the repository, and CLAUDE.md's build order lists the Co-Founder's
// steps.

import assert from "node:assert/strict";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { socialAppSettings } from "@/lib/social-settings";
import { check } from "./helpers";
import { read } from "./source-helpers";

const ROOT = process.cwd();

// docker-compose.yml's own, for the local database: the app never reads them.
const DOCKER_ONLY_SETTINGS = ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"];

// The docs whose file names must all exist.
const DOCS = ["CLAUDE.md", "README.md", "docs/going-live.md", "IMPLEMENTATION_PLAN.md", "CODEBASE_AUDIT.md"];

// Every setting lib/env.ts reads: the keys of its schema (four spaces in),
// and the social apps' pairs it takes from lib/social-settings.ts.
async function settingsTheAppReads(): Promise<string[]> {
  const envSource = await read("lib/env.ts");
  const keys = [...envSource.matchAll(/^ {4}([A-Z][A-Z0-9_]+): /gm)].map((match) => match[1]);
  return [...new Set([...keys, ...Object.keys(socialAppSettings)])].sort();
}

async function exists(file: string): Promise<boolean> {
  return access(path.join(ROOT, file)).then(
    () => true,
    () => false,
  );
}

function countOf(text: string, character: string): number {
  return text.split(character).length - 1;
}

// A path as a doc writes it, without the punctuation after it: a full stop,
// a comma, or a bracket that closes the sentence or a markdown link rather
// than the path's own "(marketing)".
function cleanReference(raw: string): string {
  let reference = raw.split("](")[0];
  while (/[.,!?)\]]$/.test(reference)) {
    const last = reference.at(-1) ?? "";
    const opener = last === ")" ? "(" : "[";
    if ((last === ")" || last === "]") && countOf(reference, opener) >= countOf(reference, last)) {
      break;
    }
    reference = reference.slice(0, -1);
  }
  return reference.replace(/\/$/, "");
}

// True when the doc's path is a file or folder of the repo; "db/migrations/0017"
// names a migration by its number.
async function referenceExists(reference: string): Promise<boolean> {
  if (await exists(reference)) {
    return true;
  }
  const folder = path.dirname(reference);
  const start = path.basename(reference);
  if (!/^\d{4}$/.test(start)) {
    return false;
  }
  return (await readdir(path.join(ROOT, folder)).catch(() => [] as string[])).some((name) => name.startsWith(start));
}

export async function runDocsChecks() {
  await check("docs: .env.example names every setting lib/env.ts reads and no other, and docs/going-live.md names each one", async () => {
    const settings = await settingsTheAppReads();
    assert.ok(settings.length >= 40, `only ${settings.length} settings read from lib/env.ts`);
    const example = await read(".env.example");
    const named = [...example.matchAll(/^#? ?([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]).filter((name) => !DOCKER_ONLY_SETTINGS.includes(name));
    assert.deepEqual([...new Set(named)].sort(), settings);
    const goingLive = await read("docs/going-live.md");
    for (const setting of settings) {
      assert.ok(goingLive.includes(`\`${setting}\``), `docs/going-live.md never names ${setting}`);
    }
  });

  await check("docs: the README names every package script (pnpm <script>)", async () => {
    const scripts = Object.keys((JSON.parse(await read("package.json")) as { scripts: Record<string, string> }).scripts);
    const readme = await read("README.md");
    for (const script of scripts) {
      assert.ok(new RegExp(`pnpm ${script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(readme), `README.md never names pnpm ${script}`);
    }
  });

  await check("docs: every file or folder CLAUDE.md, the README, docs/going-live.md, IMPLEMENTATION_PLAN.md and CODEBASE_AUDIT.md name exists", async () => {
    const pathPattern = /(?<![\w/.@[-])((?:app|lib|db|services|adapters|components|scripts|docs)\/[^\s,;:"'`*<>]*)/g;
    let references = 0;
    for (const doc of DOCS) {
      const text = await read(doc);
      for (const match of text.matchAll(pathPattern)) {
        const reference = cleanReference(match[1]);
        references += 1;
        assert.ok(await referenceExists(reference), `${doc} names ${reference}, which doesn't exist`);
      }
    }
    assert.ok(references > 500, `only ${references} file names found`);
  });

  await check("docs: every pg_dump the docs tell the operator to run writes its file outside the repository (a dump holds every company's data), and .gitignore ignores *.dump as a last guard", async () => {
    let dumps = 0;
    for (const doc of DOCS) {
      for (const match of (await read(doc)).matchAll(/`pg_dump [^`]*`/g)) {
        dumps += 1;
        assert.match(match[0], / -f ~\/ansa-backups\//, `${doc}: ${match[0]} doesn't write to ~/ansa-backups/`);
        // A shell redirect (" > file"), not the "<direct url>" placeholder.
        assert.ok(!/\s>\s/.test(match[0]), `${doc}: ${match[0]} writes where the shell happens to be`);
      }
    }
    assert.ok(dumps >= 2, `only ${dumps} pg_dump commands found (IMPLEMENTATION_PLAN.md and docs/going-live.md each give one)`);
    assert.match(await read(".gitignore"), /^\*\.dump$/m);
  });

  await check("docs: CLAUDE.md's build order lists the Co-Founder's steps 34 to 43, and its Before launch list what the Co-Founder needs", async () => {
    const claude = await read("CLAUDE.md");
    const buildOrder = claude.slice(claude.indexOf("## Build order"), claude.indexOf("## Known gaps"));
    const coFounder = buildOrder.slice(buildOrder.indexOf("Co-Founder"));
    for (let step = 34; step <= 43; step++) {
      assert.match(coFounder, new RegExp(`^${step}\\. `, "m"), `the build order has no step ${step}`);
    }
    const beforeLaunch = claude.slice(claude.indexOf("## Before launch"), claude.indexOf("## Decisions log"));
    for (const need of ["MEDIA_PROVIDER", "/api/cron/publish", "LinkedIn", "Meta", "X", "Google"]) {
      assert.ok(beforeLaunch.includes(need), `Before launch doesn't name ${need}`);
    }
  });
}
