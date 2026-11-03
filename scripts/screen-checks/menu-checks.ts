// Menu checks, on the code itself, as ui-polish-checks.ts does. Without an
// AI to read the owner's menu (no Anthropic API key and no Claude Code on
// the computer), a development brain answers a sample menu: the page shows
// it under its banner, and never offers to add it as the owner's menu.

import assert from "node:assert/strict";
import { check } from "./check";
import { read, withoutComments } from "./source-helpers";

// Which guard the text at `index` sits in: a {notes.standIn && (...)} block
// (the sample), a {!notes.standIn && (...)} one (a menu ansa read), or none.
function guardAround(source: string, index: number): "sample" | "read" | "none" {
  const sample = source.lastIndexOf("{notes.standIn && (", index);
  const read = source.lastIndexOf("{!notes.standIn && (", index);
  const opening = Math.max(sample, read);
  if (opening === -1 || source.slice(opening, index).includes(")}")) {
    return "none";
  }
  return read > sample ? "read" : "sample";
}

export async function runMenuChecks() {
  await check("menu: the development stand-in's sample menu shows with its banner, never with \"Looks right\", and a submit never saves it", async () => {
    const source = withoutComments(await read("components/menu/menu-reader.tsx"));
    const banner = source.indexOf("this is a sample menu, not yours");
    assert.ok(banner >= 0, "the sample's banner is gone");
    assert.equal(guardAround(source, banner), "sample", "the banner shows for the sample");
    const offers = [...source.matchAll(/Looks right/g)];
    assert.ok(offers.length >= 1, "\"Looks right\" is gone");
    for (const offer of offers) {
      assert.equal(guardAround(source, offer.index), "read", "\"Looks right\" shows only for a menu ansa read");
    }
    assert.match(source, /if \(!notes\.standIn\) \{\s*save\(rows\);\s*\}/, "a submit never saves the sample");
  });
}
