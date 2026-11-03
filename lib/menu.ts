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

// A price as people write it in whole smallest units, or null when it isn't
// one: core's money.ParsePrice, kept equal by the cases both read
// (core/internal/money/testdata/prices.json). Only digits, "." and ","
// count ("€ 12", "1 200", "৪৫০ টাকা": any script's digits). One mark before
// at most the currency's decimals is the point ("9,50"); one before exactly
// three digits groups thousands ("1,200"), unless the currency has three
// decimals (KWD's "1.250"); with both marks the last is the point
// ("1.200,50", "1,200.50"); a mark used twice groups ("1,200,000", or the
// South Asian way "1,50,000").
export function parsePrice(text: string, currency: string): number | null {
  // A minus sign would otherwise be ignored with the symbols: "-5" is no price.
  if (/[-\u2212]/.test(text)) {
    return null;
  }
  const digits = minorUnitDigits(currency);
  const number = withAsciiDigits(text.normalize("NFKC"))
    .replace(/[^0-9.,]/g, "")
    .replace(/[.,]+$/, "");
  const parts = splitPrice(number, digits);
  if (!parts || parts.whole.length === 0 || parts.whole.length > 9 || parts.fraction.length > digits) {
    return null;
  }
  const cents = Number(parts.whole) * 10 ** digits + Number(parts.fraction.padEnd(digits, "0") || "0");
  return cents <= MENU_PRICE_MAX_CENTS ? cents : null;
}

// Every script's decimal digits as 0-9 ("৪৫০" is "450"), as core's
// money.WithASCIIDigits: Unicode keeps each script's digits in a row from 0
// to 9, so a digit's value is how far it sits from its row's zero.
function withAsciiDigits(text: string): string {
  return text.replace(/\p{Nd}/gu, (digit) => {
    const code = digit.codePointAt(0) ?? 0;
    let zero = code;
    while (/\p{Nd}/u.test(String.fromCodePoint(zero - 1))) {
      zero -= 1;
    }
    return String((code - zero) % 10);
  });
}

// Digits and marks split into the whole number (its grouping left out) and
// the decimals; null when the marks make no price.
function splitPrice(number: string, digits: number): { whole: string; fraction: string } | null {
  const last = Math.max(number.lastIndexOf("."), number.lastIndexOf(","));
  if (last < 0) {
    return { whole: number, fraction: "" };
  }
  const mark = number[last];
  const other = mark === "," ? "." : ",";
  const before = number.slice(0, last);
  const after = number.slice(last + 1);
  if (before.includes(mark)) {
    // One mark used twice groups, and there are no decimals.
    const whole = grouped(number, mark);
    return whole === null ? null : { whole, fraction: "" };
  }
  if (before.includes(other)) {
    // Both marks: the last one is the point.
    const whole = grouped(before, other);
    return whole === null ? null : { whole, fraction: after };
  }
  if (after.length === 3 && digits < 3 && isLeadingGroup(before, 3)) {
    // "1,200": three digits can't be this currency's decimals.
    return { whole: before + after, fraction: "" };
  }
  return { whole: before, fraction: after };
}

// A whole number written in groups: of three ("1,200,000") or, the South
// Asian way, of two before the last three ("1,50,000"). Null when it is no
// such number.
function grouped(number: string, mark: string): string | null {
  const groups = number.split(mark);
  const size = groups.length > 2 && groups[1].length === 2 ? 2 : 3;
  if (groups.length < 2 || !isLeadingGroup(groups[0], size) || groups[groups.length - 1].length !== 3) {
    return null;
  }
  if (groups.slice(1, -1).some((group) => group.length !== size)) {
    return null;
  }
  const joined = groups.join("");
  return /^[0-9]+$/.test(joined) ? joined : null;
}

// The first group of a grouped number: 1 to `size` digits, no leading zero
// ("0,500" groups nothing: it is no five hundred).
function isLeadingGroup(group: string, size: number): boolean {
  return group.length >= 1 && group.length <= size && group[0] !== "0";
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
