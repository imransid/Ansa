import { checkAssistantReply, type ReplyCheckData } from "@/lib/assistant/reply-checks";
import { checkContentRules, composePublishedText } from "@/lib/content-rules";
import type { AutopostText } from "./answer";

// ansa's checks before a "Post for me" post may go out (step 54), on the
// whole published text: every amount with a currency mark is a price on
// the business's list or in its own words, no refund or compensation
// words, every link the owner's own (step 49's reply checks); every
// percentage and every discount, promo or coupon word the owner's own (an
// offer the AI made up is the worst post); and Facebook's own rules
// (length, the owner's words to avoid). Pure.

const OFFER_WORDS = /\b(discount|discounts|promo|promotion|coupon|voucher|sconto|descuento|remise|rabatt)\b/giu;

export function checkAutopostText(post: AutopostText, data: ReplyCheckData & { wordsToAvoid: readonly string[] }): boolean {
  const text = composePublishedText(post);
  if (!checkAssistantReply(text, data).ok) {
    return false;
  }
  const owners = data.ownerTexts.join("\n").toLowerCase();
  const percentages = text.match(/\d+(?:[.,]\d+)?\s?%/g) ?? [];
  if (percentages.some((percentage) => !owners.includes(percentage.replace(/\s/g, "")) && !owners.includes(percentage))) {
    return false;
  }
  const offers = text.toLowerCase().match(OFFER_WORDS) ?? [];
  if (offers.some((word) => !owners.includes(word))) {
    return false;
  }
  const issues = checkContentRules(
    { platform: "facebook", format: "post", title: "", body: post.body, hashtags: post.hashtags, callToAction: post.callToAction, videoScript: "" },
    { media: null, wordsToAvoid: data.wordsToAvoid },
  );
  return !issues.some((issue) => issue.severity === "blocking");
}
