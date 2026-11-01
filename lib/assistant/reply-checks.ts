import { parsePrice } from "@/lib/menu";
import type { HandoverReason } from "./reasons";

// What ansa checks in the assistant's reply before it may be sent (step 49),
// whatever the AI was told: every price is one the restaurant wrote (a menu
// price, or an amount in the owner's own notes, instructions or articles),
// no refund or compensation is promised, and every link is one the
// restaurant wrote. A reply that fails is never sent: the customer gets the
// holding reply and a person is asked. Pure.

export type ReplyCheckData = {
  currency: string;
  // The menu's prices, in the currency's smallest unit.
  menuPrices: number[];
  // Everything the restaurant wrote that the AI read: instructions, the
  // delivery and payment notes, its details, the articles' text.
  ownerTexts: string[];
};

export type ReplyCheck = { ok: true } | { ok: false; reason: Extract<HandoverReason, "price_not_on_menu" | "refund_promise" | "unknown_link"> };

// Currency marks people and models write next to an amount: symbols, ISO
// codes and the words for the common ones.
const SYMBOLS = "€$£¥₹৳₺₽₩₪₫฿₱₦₴₸₭";
const CODES =
  "EUR|USD|GBP|CHF|JPY|INR|BDT|TRY|RUB|KRW|ILS|VND|THB|PHP|NGN|UAH|KZT|SEK|NOK|DKK|PLN|BRL|CAD|AUD|NZD|MXN|AED|SAR|ZAR|CNY|HKD|SGD|MYR|IDR|PKR|EGP|CZK|HUF|RON";
const WORDS = "euros?|dollars?|pounds?|taka|rupees?|francs?|yen|lira|kr|zł|złoty";
const AMOUNT = String.raw`\d{1,3}(?:[ .,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const MARK = String.raw`[${SYMBOLS}]|R\$|\b(?:${CODES})\b`;
const MONEY_BEFORE = new RegExp(String.raw`(?:${MARK})\s?(${AMOUNT})`, "giu");
const MONEY_AFTER = new RegExp(String.raw`(${AMOUNT})\s?(?:[${SYMBOLS}]|\b(?:${CODES}|${WORDS})\b)`, "giu");

// Words of a refund, compensation or voucher, in the languages restaurants
// write most: a reply holding one goes to a person, promised or not.
const REFUND_WORDS = /\b(?:refund\w*|reimburs\w*|compensat\w*|money back|voucher\w*|rimbors\w*|risarci\w*|reembols\w*|indemniz\w*|rembours\w*|dédommag\w*|erstatt\w*|entschädig\w*|gutschein\w*)/iu;

const LINK = /\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+/giu;

export function checkAssistantReply(text: string, data: ReplyCheckData): ReplyCheck {
  if (!pricesAreKnown(text, data)) {
    return { ok: false, reason: "price_not_on_menu" };
  }
  if (REFUND_WORDS.test(text)) {
    return { ok: false, reason: "refund_promise" };
  }
  if (!linksAreKnown(text, data.ownerTexts)) {
    return { ok: false, reason: "unknown_link" };
  }
  return { ok: true };
}

// The amounts written with a currency mark, in smallest units; null for one
// that can't be read as a price of this currency (never allowed).
export function moneyAmountsIn(text: string, currency: string): (number | null)[] {
  const amounts: (number | null)[] = [];
  for (const pattern of [MONEY_BEFORE, MONEY_AFTER]) {
    for (const match of text.matchAll(pattern)) {
      amounts.push(parsePrice(match[1].replace(/[ ](?=\d{3}\b)/g, ""), currency));
    }
  }
  return amounts;
}

function pricesAreKnown(text: string, data: ReplyCheckData): boolean {
  const allowed = new Set(data.menuPrices);
  for (const ownerText of data.ownerTexts) {
    for (const amount of moneyAmountsIn(ownerText, data.currency)) {
      if (amount !== null) {
        allowed.add(amount);
      }
    }
  }
  return moneyAmountsIn(text, data.currency).every((amount) => amount !== null && allowed.has(amount));
}

function linksAreKnown(text: string, ownerTexts: string[]): boolean {
  const written = ownerTexts.join("\n").toLowerCase();
  return [...text.matchAll(LINK)].every((match) => {
    const link = match[0].replace(/[.,!?;:)\]]+$/u, "").toLowerCase();
    return written.includes(link.replace(/^https?:\/\//, ""));
  });
}
