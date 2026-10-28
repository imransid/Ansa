// Co-Founder consistency checks (step 43), on the code itself: every page of
// the section shows a loading line while it reads the session, sits below
// the section's header, row of links and error boundary, names its own
// address for logging in, has a not-found page where its address holds an
// id or a number, waits 300 seconds where its actions ask Claude or send
// posts, and shows times only in the viewer's own timezone.

import assert from "node:assert/strict";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { check } from "./helpers";
import { read, withoutComments } from "./source-helpers";

const ROOT = process.cwd();

// Every page.tsx under app/cofounder, as paths from the repo root.
async function coFounderPages(): Promise<string[]> {
  const entries = await readdir(path.join(ROOT, "app", "cofounder"), { recursive: true });
  return entries.filter((entry) => path.basename(entry) === "page.tsx").map((entry) => path.join("app", "cofounder", entry));
}

// The address a page answers at, with its [segments] as they are written.
function addressOf(page: string): string {
  return `/${path.dirname(page).replace(/^app\//, "").split(path.sep).join("/")}`;
}

async function exists(file: string): Promise<boolean> {
  return access(path.join(ROOT, file)).then(
    () => true,
    () => false,
  );
}

// Pages whose server actions ask Claude, or start work after the answer
// (an image made, a post sent): they need the host's longest time.
const PAGES_WAITING_LONG = [
  "/cofounder/interview",
  "/cofounder/profile",
  "/cofounder/strategy",
  "/cofounder/studio/new",
  "/cofounder/studio/[draftId]",
  "/cofounder/media",
  "/cofounder/calendar",
  "/cofounder/queue",
  "/cofounder/analytics",
];

export async function runCofounderConsistencyChecks() {
  await check("co-founder pages: each reads the session inside <Suspense> with a loading line, asking for a login back to its own address, below the section's header, row of links and error boundary; a page with an id or number in its address has a not-found page", async () => {
    const pages = await coFounderPages();
    assert.equal(pages.length, 13, "a page was added or removed: check it against this list's rules");
    for (const page of pages) {
      const source = withoutComments(await read(page));
      assert.match(source, /<Suspense fallback=\{<p className="text-muted-foreground">Loading\.\.\.<\/p>\}>/, `${page} has no loading line`);
      const address = addressOf(page);
      const dynamic = /\[(\w+)\]/.exec(address);
      if (dynamic) {
        const ownAddress = address.replace(`[${dynamic[1]}]`, `\${encodeURIComponent(${dynamic[1]})}`);
        assert.ok(source.includes(`requireSessionContext(\`${ownAddress}\`)`), `${page} doesn't ask for a login back to itself`);
        const folderAbove = path.dirname(path.dirname(page));
        assert.ok((await exists(path.join(path.dirname(page), "not-found.tsx"))) || (await exists(path.join(folderAbove, "not-found.tsx"))), `${page} has no not-found page`);
        assert.match(source, /notFound\(\)/, `${page} never answers "not found"`);
      } else {
        assert.ok(source.includes(`requireSessionContext("${address}")`), `${page} doesn't ask for a login back to itself`);
      }
      const waitsLong = /^export const maxDuration = 300;$/m.test(source);
      assert.equal(waitsLong, PAGES_WAITING_LONG.includes(address), `${page}: maxDuration 300 ${waitsLong ? "set" : "missing"}`);
    }
    const layout = withoutComments(await read("app/cofounder/layout.tsx"));
    assert.match(layout, /<AppFrame\s+section="cofounder"/);
    assert.match(withoutComments(await read("components/app-frame.tsx")), /<PageErrorBoundary>\{children\}<\/PageErrorBoundary>/);
  });

  await check("co-founder pages: times show in the viewer's own timezone (LocalDateTime, or the calendar's days worked out in the browser); no page formats a date on the server", async () => {
    const entries = await readdir(path.join(ROOT, "app", "cofounder"), { recursive: true });
    const files = entries.filter((entry) => entry.endsWith(".tsx")).map((entry) => path.join("app", "cofounder", entry));
    let localTimes = 0;
    for (const file of files) {
      const source = withoutComments(await read(file));
      for (const serverFormat of [/\.toLocaleDateString\(/, /\.toLocaleTimeString\(/, /\.toUTCString\(/, /\.toDateString\(/, /\.toISOString\(\)\.slice\(/, /\.get(Hours|Minutes|Date|Day|Month|FullYear)\(\)/]) {
        assert.ok(!serverFormat.test(source), `${file} formats a date itself (${serverFormat})`);
      }
      localTimes += (source.match(/<LocalDateTime\b/g) ?? []).length;
    }
    assert.ok(localTimes >= 20, `only ${localTimes} times shown through LocalDateTime`);
  });
}
