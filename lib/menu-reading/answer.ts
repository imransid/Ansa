import { z } from "zod";
import { cutToLength } from "@/lib/cofounder/fact-proposals";
import {
  MENU_CATEGORY_MAX_LENGTH,
  MENU_DESCRIPTION_MAX_LENGTH,
  MENU_ITEMS_PER_READING_MAX,
  MENU_NAME_MAX_LENGTH,
  parsePrice,
} from "@/lib/menu";
import type { ModelResult } from "@/lib/model-request";
import { toPlainSingleLine } from "@/lib/plain-text";

// Reading Claude's answer for "Read my menu" (step 46), written twice like
// every other use: the JSON schema the API enforces
// (brain/brain/menu/reading.py) and this Zod schema. A field we didn't ask
// for around the list makes the answer unusable; then each dish is kept or
// dropped on its own: a name, a price this code can read in the
// restaurant's currency, texts as one plain line cut to the menu's limits,
// at most MENU_ITEMS_PER_READING_MAX dishes. Core keeps or drops each dish
// the same way (core/internal/menureading).

const rowSchema = z.object({ category: z.string(), name: z.string(), description: z.string(), price: z.string() }).strict();
const answerSchema = z.object({ items: z.array(z.unknown()) }).strict();

// One dish read from the menu, as the owner checks it before saving.
export type ProposedMenuItem = { category: string; name: string; description: string; priceCents: number };

export type MenuReading = { items: ProposedMenuItem[]; dropped: number };

// The dishes read, and how many rows were dropped; null when there is
// nothing to read: not asked (no API key), refused, cut off, failed, not JSON
// or another shape.
export function readMenuReadingAnswer(result: ModelResult, currency: string): MenuReading | null {
  if (result.kind !== "ok") {
    return null;
  }
  const parsed = answerSchema.safeParse(parseJsonOrNull(result.outputText));
  if (!parsed.success) {
    return null;
  }
  const items: ProposedMenuItem[] = [];
  let dropped = 0;
  for (const row of parsed.data.items) {
    const item = items.length < MENU_ITEMS_PER_READING_MAX ? readRow(row, currency) : null;
    if (item) {
      items.push(item);
    } else {
      dropped += 1;
    }
  }
  return { items, dropped };
}

// One row as a dish, or null when it lacks what a dish needs.
function readRow(row: unknown, currency: string): ProposedMenuItem | null {
  const parsed = rowSchema.safeParse(row);
  if (!parsed.success) {
    return null;
  }
  const name = cleanLine(parsed.data.name, MENU_NAME_MAX_LENGTH);
  const priceCents = parsePrice(parsed.data.price, currency);
  if (!name || priceCents === null) {
    return null;
  }
  return {
    category: cleanLine(parsed.data.category, MENU_CATEGORY_MAX_LENGTH),
    name,
    description: cleanLine(parsed.data.description, MENU_DESCRIPTION_MAX_LENGTH),
    priceCents,
  };
}

function cleanLine(text: string, maxLength: number): string {
  return cutToLength(toPlainSingleLine(text), maxLength);
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
