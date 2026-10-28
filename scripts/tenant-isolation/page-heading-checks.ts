// Page heading checks (step 37 review fixes), on the code itself: every page
// of a signed-in section has a level-1 heading, so a screen reader can jump
// to where the page starts (the app header has none). It is written in the
// page or in a file next to it that the page imports, as the ticket page's
// ticket-summary.tsx and the article page's article-summary.tsx are.

import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { SIGNED_IN_SECTIONS } from "@/lib/login-redirect";
import { check } from "./helpers";

const ROOT = process.cwd();

// Every page.tsx under a signed-in section, as paths from the repo root.
async function signedInPages(): Promise<string[]> {
  const pages: string[] = [];
  for (const section of SIGNED_IN_SECTIONS) {
    const folder = path.join("app", section.slice(1));
    const entries = await readdir(path.join(ROOT, folder), { recursive: true });
    pages.push(...entries.filter((entry) => path.basename(entry) === "page.tsx").map((entry) => path.join(folder, entry)));
  }
  return pages;
}

// The page's source, and the source of each file next to it that it
// imports (from "./ticket-summary").
async function sourcesOfPage(page: string): Promise<string[]> {
  const source = await readFile(path.join(ROOT, page), "utf8");
  const sources = [source];
  for (const match of source.matchAll(/from "\.\/([\w-]+)"/g)) {
    const file = path.join(ROOT, path.dirname(page), `${match[1]}.tsx`);
    const exists = await access(file).then(
      () => true,
      () => false,
    );
    if (exists) {
      sources.push(await readFile(file, "utf8"));
    }
  }
  return sources;
}

export async function runPageHeadingChecks() {
  await check("pages: every page of a signed-in section has a level-1 heading, in the page or a file next to it that it imports", async () => {
    const pages = await signedInPages();
    for (const page of pages) {
      const sources = await sourcesOfPage(page);
      assert.ok(sources.some((source) => source.includes("<h1")), `${page} has no <h1>`);
    }
    // 19 pages when this check was written: the list really was read.
    assert.ok(pages.length >= 19, `found only ${pages.length} pages`);
  });
}
