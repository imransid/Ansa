// The restaurant's menu (step 46): limits, and prices as whole numbers of the
// currency's smallest unit (cents for EUR, yen for JPY). Pure: the menu page,
// its forms and the reading of a menu photo share it; core keeps its own
// copy (core/internal/menu, core/internal/money).

export const MENU_CATEGORY_MAX_LENGTH = 60;
export const MENU_NAME_MAX_LENGTH = 120;
export const MENU_DESCRIPTION_MAX_LENGTH = 500;
// A price above this is a typo (or a misread photo), not a dish.
export const MENU_PRICE_MAX_CENTS = 100_000_000;
export const MENU_PRICE_TEXT_MAX_LENGTH = 20;
// At most this many dishes per restaurant, and per reading of a menu.
export const MENU_ITEMS_MAX = 500;
export const MENU_ITEMS_PER_READING_MAX = 150;
// Pasted menus and the text taken from a PDF or Word file, as read.
export const MENU_TEXT_MAX_LENGTH = 20_000;

// What a dish is shown under when it has no category.
export const NO_CATEGORY_LABEL = "Other dishes";

// How many digits the currency has after the decimal point: 2 for EUR, 0 for
// JPY, 3 for BHD.
export function minorUnitDigits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

// A price as people write it ("9.50", "9,50", "€ 12", "1 200") in whole
// smallest units, or null when it isn't one. Spaces, currency symbols and
// letters around the number are ignored; one "." or "," before at most as
// many digits as the currency has is the decimal point.
export function parsePrice(text: string, currency: string): number | null {
  // A minus sign would otherwise be ignored with the symbols: "-5" is no price.
  if (/[-\u2212]/.test(text)) {
    return null;
  }
  const digits = minorUnitDigits(currency);
  const number = text
    .normalize("NFKC")
    .replace(/[^\d.,]/g, "")
    .replace(/[.,]$/, "");
  const match = /^(\d{1,9})(?:[.,](\d+))?$/.exec(number);
  if (!match) {
    return null;
  }
  const [, whole, fraction = ""] = match;
  if (fraction.length > digits) {
    return null;
  }
  const cents = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  return cents <= MENU_PRICE_MAX_CENTS ? cents : null;
}

// "€9.50", as the menu page and the order ticket show it.
export function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(cents / 10 ** minorUnitDigits(currency));
}

// "9.50": a stored price as the edit form shows it, ready to type over.
export function priceForEditing(cents: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  return (cents / 10 ** digits).toFixed(digits);
}

// The menu's categories in the order of their first dish, each with its
// dishes in order. Dishes come in their stored order (position).
export function groupByCategory<Item extends { category: string }>(items: Item[]): { category: string; items: Item[] }[] {
  const groups: { category: string; items: Item[] }[] = [];
  for (const item of items) {
    const label = item.category || NO_CATEGORY_LABEL;
    const group = groups.find((candidate) => candidate.category === label);
    if (group) {
      group.items.push(item);
    } else {
      groups.push({ category: label, items: [item] });
    }
  }
  return groups;
}

// Production never shows the development stand-in's sample menu: there,
// without an API key, reading a menu says the AI isn't available.
export function menuStandInAllowed(nodeEnv: string | undefined): boolean {
  return nodeEnv !== "production";
}
