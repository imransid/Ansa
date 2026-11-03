// Website checks (step 58), on the code itself: the public website says only
// what works today. Its prices and limits are core's (core's website.json,
// which core's test keeps equal to core/internal/packages/packages.go), which
// channels work is one list, and no "LAUNCH CHECK" note is left.

import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { packageLines } from "@/lib/packages";
import { channelsInWords, listInWords, WEBSITE_CHANNELS } from "@/lib/website-channels";
import { lowestMonthlyPrice, WEBSITE_PACKAGES } from "@/lib/website-packages";
import { check } from "./check";
import { read, withoutComments } from "./source-helpers";

// Every .ts and .tsx file under a folder, as paths from the repository's root.
async function sourceFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(path)));
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

export async function runWebsiteChecks() {
  await check("website: the Pricing page shows core's packages (core/internal/packages/website.json), the free trial first, and names no channel that isn't open to everyone", async () => {
    const fromCore = JSON.parse(await read("core/internal/packages/website.json"));
    assert.deepEqual(WEBSITE_PACKAGES, fromCore);
    assert.equal(WEBSITE_PACKAGES.trial.key, "trial");
    assert.deepEqual(WEBSITE_PACKAGES.paid.map((pkg) => pkg.key), ["personal", "business", "pro"]);
    for (const pkg of [WEBSITE_PACKAGES.trial, ...WEBSITE_PACKAGES.paid]) {
      assert.ok(["none", "three_a_week", "daily"].includes(pkg.postForMe), `${pkg.key}: an unknown posting frequency`);
      for (const line of packageLines(pkg, "website")) {
        assert.doesNotMatch(line, /WhatsApp|Telegram|Messenger and|calls answered/, `${pkg.key}: "${line}" names a channel`);
      }
    }
    assert.equal(lowestMonthlyPrice(), Math.min(...fromCore.paid.map((pkg: { priceUsd: number }) => pkg.priceUsd)));
    const list = withoutComments(await read("app/(marketing)/pricing/package-list.tsx"));
    assert.match(list, /packageLines\(trial, "website"\)/);
    assert.match(list, /paid\.map\(/);
    assert.doesNotMatch(withoutComments(await read("app/(marketing)/pricing/page.tsx")) + list, /\$\d/, "a price typed into the page");
  });

  await check("website: which channels work is one list (lib/website-channels.ts) that the home page and Pricing read; Telegram and email work today", async () => {
    assert.ok(WEBSITE_CHANNELS.every((channel) => channel.status === "now" || channel.status === "soon"));
    assert.equal(channelsInWords("now"), "Telegram and email (as notes)");
    assert.equal(listInWords(["a", "b", "c"]), "a, b and c");
    assert.equal(listInWords(["a"]), "a");
    for (const file of ["channels.tsx", "how-it-works.tsx", "questions.tsx"]) {
      const source = withoutComments(await read(`app/(marketing)/_landing/${file}`));
      assert.match(source, /from "@\/lib\/website-channels"/, `${file} doesn't read the channel list`);
    }
  });

  await check("website: no LAUNCH CHECK note is left, and the legal pages name every outside service ansa sends data to", async () => {
    for (const folder of ["app", "components", "lib"]) {
      for (const file of await sourceFiles(folder)) {
        assert.ok(!(await read(file)).includes("LAUNCH CHECK"), `${file} still has a LAUNCH CHECK note`);
      }
    }
    const privacy = await read("app/(marketing)/privacy/who-helps.tsx");
    for (const service of ["Anthropic", "Telegram", "Meta", "LinkedIn", "Vapi", "Resend", "Cloudflare", "Neon", "Stripe", "hosting provider"]) {
      assert.ok(privacy.includes(service), `the privacy policy doesn't name ${service}`);
    }
  });
}
