import "server-only";
import { getAssistantSettings } from "@/db/assistant-settings";
import { claimPostingTime, finishPostingTime, listPostingTimes, type AutopostCompany } from "@/db/autopost";
import { getBusinessFactsForCompany } from "@/db/business-facts";
import { createContentDraft } from "@/db/content-draft-writes";
import { listMenuItems } from "@/db/menu";
import { scheduleDraftPosts } from "@/db/publish-scheduling";
import { getCompanySetup } from "@/db/restaurant-setup";
import { listSocialConnections } from "@/db/social-connections";
import { readAutopostAnswer, type AutopostText } from "@/lib/autopost/answer";
import { chooseNextPost, type PostChoice } from "@/lib/autopost/brain";
import { checkAutopostText } from "@/lib/autopost/checks";
import { buildAutopostRequest, type AutopostContext } from "@/lib/autopost/prompt";
import type { SkipReason } from "@/lib/autopost/slots";
import { readWordsToAvoid } from "@/lib/content-studio/words-to-avoid";
import { formatPrice } from "@/lib/menu";
import type { ModelAsker } from "@/lib/model-request";
import { describeDay, isOpeningHours, WEEKDAYS } from "@/lib/opening-hours";
import { localDateOf, weekdayOf } from "@/lib/publishing/schedule-time";
import { BUSINESS_TYPE_LABELS } from "@/lib/restaurant-setup";
import { assistantAskerFor } from "./assistant-engine";

// Writes one "Post for me" post (step 54) for one company and posting time:
// ansa's brain picks what to post about (lib/autopost/brain.ts, learning
// from the numbers of the posts before), the AI writes it from the
// business's own details only, ansa's checks read it (a second try on
// another kind of post when they stop it), and it becomes a draft
// scheduled in the publishing queue under the owner's "Post for me" rule
// (Automatic), or waiting for an owner's approval (Ask me first). The
// posting time is claimed first, so two runs write it once. LOGGING RULE:
// never the post, the prompt or the AI's answer.

export type WriteOutcome = { outcome: "scheduled"; jobIds: string[] } | { outcome: "waiting_approval" | "skipped" | "taken" };

// Only the checks pass these: a fake model (null: none set up) and a NODE_ENV.
export type WriterOptions = { asker?: ModelAsker | null; nodeEnv?: string };

const HISTORY_READ = 30;
const OFFERS_SENT = 40;

export async function writePostFor(company: AutopostCompany, postAt: Date, options: WriterOptions = {}): Promise<WriteOutcome> {
  const { companyId } = company;
  const [setup, settings, facts, menu, history, connections] = await Promise.all([
    getCompanySetup(companyId),
    getAssistantSettings(companyId),
    getBusinessFactsForCompany(companyId),
    listMenuItems(companyId),
    listPostingTimes(companyId, HISTORY_READ),
    listSocialConnections(companyId),
  ]);
  const date = localDateOf(postAt, company.timeZone);
  const available = menu.filter((item) => item.available);
  const pastPosts = history
    .filter((slot) => slot.status !== "skipped")
    .map((slot) => ({ kind: slot.kind, itemName: slot.itemName, specialDay: slot.specialDay, engagement: slot.engagement }));
  const brainInput = { kind: setup.kind, businessType: setup.businessType, items: available.map((item) => item.name), date, weekday: weekdayOf(date), history: pastPosts };
  let choice = chooseNextPost(brainInput);
  const slotId = await claimPostingTime(companyId, postAt, choice);
  if (!slotId) {
    return { outcome: "taken" };
  }
  const pages = connections.filter((connection) => connection.platform === "facebook" && connection.status === "connected").map((connection) => connection.id);
  if (pages.length === 0) {
    return skip(companyId, slotId, "no_page", 0);
  }
  const asker = options.asker === undefined ? await assistantAskerFor(companyId, options.nodeEnv ?? process.env.NODE_ENV, "post") : options.asker;
  if (!asker) {
    return skip(companyId, slotId, "no_ai", 0);
  }
  const fact = (topic: string) => facts.find((row) => row.topic === topic)?.confirmedValue ?? "";
  const currency = settings?.currency ?? "EUR";
  const ownerTexts = [settings?.instructions ?? "", settings?.deliveryNote ?? "", settings?.paymentNote ?? "", fact("description"), ...available.map((item) => item.description)];
  const checkData = { currency, menuPrices: available.map((item) => item.priceCents), ownerTexts, wordsToAvoid: readWordsToAvoid(fact("words_to_avoid") || null) };
  const context: Omit<AutopostContext, "choice"> = {
    businessName: fact("company_name") || setup.companyName,
    businessType: setup.businessType ? BUSINESS_TYPE_LABELS[setup.businessType] : "Business",
    description: fact("description"),
    address: fact("location"),
    hours: hoursLines(settings?.openingHours),
    offers: available.slice(0, OFFERS_SENT).map((item) => [item.name, formatPrice(item.priceCents, currency), item.description].filter(Boolean).join(" | ")),
    instructions: settings?.instructions ?? "",
    wordsToAvoid: checkData.wordsToAvoid,
    recentPosts: history.flatMap((slot) => (slot.body ? [slot.body.split("\n")[0].slice(0, 200)] : [])).slice(0, 5),
    day: `${weekdayOf(date)} ${date}`,
  };
  // Two tries: a text ansa's checks stop gets one more, on another kind of post.
  let post: AutopostText | null = null;
  let attempts = 0;
  let failure: SkipReason = "checks_failed";
  for (; attempts < 2 && !post; attempts++) {
    if (attempts > 0) {
      choice = chooseNextPost({ ...brainInput, skip: [choice.kind] });
    }
    const result = await asker(buildAutopostRequest({ ...context, choice }));
    if (result.kind !== "ok") {
      if (result.kind === "error") {
        console.error(`Claude call failed: ${result.errorName}`);
      }
      failure = "ai_failed";
      continue;
    }
    const written = readAutopostAnswer(result.outputText);
    post = written && checkAutopostText(written, checkData) ? written : null;
  }
  if (!post) {
    return skip(companyId, slotId, failure, attempts);
  }
  return saveAndSchedule(company, slotId, postAt, choice, post, pages, attempts);
}

// The post as a draft in the owner's name, then in the queue (Automatic) or
// waiting for an owner (Ask me first).
async function saveAndSchedule(
  company: AutopostCompany,
  slotId: string,
  postAt: Date,
  choice: PostChoice,
  post: AutopostText,
  pages: string[],
  attempts: number,
): Promise<WriteOutcome> {
  const { companyId, enabledByUserId } = company;
  const fields = { title: "", body: post.body, hashtags: post.hashtags, callToAction: post.callToAction, imagePrompt: "", videoScript: "" };
  const generated = { fields, claims: [], factsUsed: [], knowledgeUsed: [], planVersion: null };
  const created = await createContentDraft(companyId, enabledByUserId, { platform: "facebook", format: "post", topic: choice.topic, pillar: "", campaign: "", generated });
  if (created.outcome !== "created") {
    return skip(companyId, slotId, "not_owner", attempts);
  }
  if (company.mode === "ask_first") {
    await finishPostingTime(companyId, slotId, { status: "waiting_approval", draftId: created.draftId, choice, attempts });
    return { outcome: "waiting_approval" };
  }
  const scheduled = await scheduleDraftPosts(companyId, enabledByUserId, { draftId: created.draftId, version: 1, connectionIds: pages, scheduledFor: postAt, withoutApproval: true });
  if (scheduled.outcome !== "scheduled") {
    // The rule was switched off or its owner left meanwhile: an owner approves it instead.
    console.warn(`Post for me not scheduled: ${scheduled.outcome}`);
    await finishPostingTime(companyId, slotId, { status: "waiting_approval", draftId: created.draftId, choice, attempts });
    return { outcome: "waiting_approval" };
  }
  await finishPostingTime(companyId, slotId, { status: "scheduled", draftId: created.draftId, choice, attempts });
  return { outcome: "scheduled", jobIds: scheduled.jobIds };
}

function hoursLines(openingHours: unknown): string[] {
  return isOpeningHours(openingHours) ? WEEKDAYS.map(({ key, label }) => `${label}: ${describeDay(openingHours[key])}`) : [];
}

async function skip(companyId: string, slotId: string, reason: SkipReason, attempts: number): Promise<WriteOutcome> {
  await finishPostingTime(companyId, slotId, { status: "skipped", reason, attempts });
  return { outcome: "skipped" };
}
