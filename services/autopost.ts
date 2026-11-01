import "server-only";
import { z } from "zod";
import { getAssistantSettings } from "@/db/assistant-settings";
import { finishPostingTime, listPostingTimes, saveAutopostSettings, upcomingPostingTimes, type AutopostCompany } from "@/db/autopost";
export type { PostedSlot } from "@/db/autopost";
import { createAutopublishRule, listAutopublishRules, setAutopublishRuleEnabled } from "@/db/autopublish-rules";
import { archiveContentDraft } from "@/db/content-draft-status";
import { listSocialConnections } from "@/db/social-connections";
import { AUTOPOST_FREQUENCIES, AUTOPOST_MODES, nextPostingTimes } from "@/lib/autopost/schedule";
import type { FormResult } from "@/lib/form-result";
import { canManageRestaurant } from "@/lib/restaurant-permissions";
import type { SessionContext } from "@/lib/session";
import { writePostFor, type WriterOptions } from "./autopost-writer";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// "Post for me" (step 54, Settings → Posts for me): the owner's one switch
// (how often, what time, Automatic or Ask me first), the next posts and
// how the last ones did. Owners change it; members read it. Switched on in
// Automatic, it switches on the company's Facebook "any topic" auto-publish
// rule in the owner's name (step 41: only an owner's switch turns one on);
// switched off, that rule goes off and the posts not out yet are taken
// back (archived, which takes them out of the queue).

const settingsSchema = z.object({
  enabled: z.enum(["on", "off"]),
  frequency: z.enum(AUTOPOST_FREQUENCIES, { error: "Choose how often." }),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a time."),
  mode: z.enum(AUTOPOST_MODES, { error: "Choose Automatic or Ask me first." }),
  // The owner's yes to posts going out without approving each one (step
  // 41's rule: only an owner's confirm switches automatic posting on).
  understood: z.string().nullish(),
});

export async function getAutopostPageForSession(session: SessionContext, now = new Date()) {
  const [settings, slots, connections] = await Promise.all([
    getAssistantSettings(session.companyId),
    listPostingTimes(session.companyId, 20),
    listSocialConnections(session.companyId),
  ]);
  const enabled = settings?.autopostEnabled ?? false;
  const timeZone = settings?.timeZone ?? null;
  const frequency = settings?.autopostFrequency ?? "three_a_week";
  const time = settings?.autopostTime ?? "11:00";
  return {
    canManage: canManageRestaurant(session.role),
    enabled,
    frequency,
    time,
    mode: settings?.autopostMode ?? "automatic",
    timeZone,
    pages: connections.filter((connection) => connection.platform === "facebook" && connection.status === "connected").map((connection) => connection.displayName),
    nextTimes: enabled && timeZone ? nextPostingTimes(frequency, time, timeZone, now, 3) : [],
    slots,
  };
}

export async function saveAutopostForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  if (!canManageRestaurant(session.role)) {
    return { ok: false, errors: { message: "Only owners change Post for me." } };
  }
  if (await isOverRateLimit("settings-changes", session.userId, RATE_LIMITS.settingsChangesPerUser)) {
    return { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
  }
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  const choices = { frequency: parsed.data.frequency, time: parsed.data.time, mode: parsed.data.mode, enabled: parsed.data.enabled === "on" };
  if (choices.enabled && choices.mode === "automatic" && parsed.data.understood !== "on") {
    return { ok: false, errors: { fieldErrors: { understood: ["Tick this to let ansa post without asking you each time, or choose Ask me first."] } } };
  }
  const saved = await saveAutopostSettings(session.companyId, session.userId, choices);
  if (saved === "no-time-zone") {
    return { ok: false, errors: { message: "Set your time zone first (Settings → What it knows → Opening hours)." } };
  }
  if (saved !== "saved") {
    return { ok: false, errors: { message: "Only owners change Post for me." } };
  }
  await setPostingRule(session, choices.enabled && choices.mode === "automatic");
  if (!choices.enabled) {
    await takeBackUpcomingPosts(session);
  }
  return { ok: true };
}

// "Post one now" (owners): a post written now and, in Automatic, queued for
// now: the caller sends it after its answer (jobIds). For trying it out.
export async function postNowForSession(session: SessionContext, options: WriterOptions = {}): Promise<FormResult & { jobIds?: string[] }> {
  if (!canManageRestaurant(session.role)) {
    return { ok: false, errors: { message: "Only owners can post." } };
  }
  if (await isOverRateLimit("autopost-now", session.companyId, RATE_LIMITS.autopostNowPerCompany)) {
    return { ok: false, errors: { message: "That's a lot of posts this hour. Try again later." } };
  }
  const settings = await getAssistantSettings(session.companyId);
  if (!settings?.autopostEnabled || !settings.timeZone || !settings.autopostEnabledByUserId) {
    return { ok: false, errors: { message: "Switch Post for me on first." } };
  }
  const company: AutopostCompany = {
    companyId: session.companyId,
    enabled: true,
    frequency: settings.autopostFrequency,
    time: settings.autopostTime,
    mode: settings.autopostMode,
    timeZone: settings.timeZone,
    enabledByUserId: settings.autopostEnabledByUserId,
  };
  // Now, to the millisecond: a moment of its own (scheduled ones are on the minute).
  const written = await writePostFor(company, new Date(), options);
  if (written.outcome === "skipped" || written.outcome === "taken") {
    return { ok: false, errors: { message: "ansa couldn't write a post just now: the list below says why." } };
  }
  return { ok: true, jobIds: written.outcome === "scheduled" ? written.jobIds : [] };
}

// The Facebook "any topic" rule, on in the owner's name or off.
async function setPostingRule(session: SessionContext, on: boolean): Promise<void> {
  const rules = await listAutopublishRules(session.companyId);
  let rule = rules.find((candidate) => candidate.platform === "facebook" && candidate.pillar === "");
  if (!rule && on) {
    const created = await createAutopublishRule(session.companyId, session.userId, { platform: "facebook", pillar: "" });
    if (created.outcome === "created") {
      rule = { id: created.ruleId, platform: "facebook", pillar: "", enabled: false, createdAt: new Date(), createdByName: null, enabledAt: null, enabledByName: null };
    }
  }
  if (rule) {
    await setAutopublishRuleEnabled(session.companyId, session.userId, rule.id, on);
  }
}

// Switched off: posts not out yet are archived (out of the queue) and
// marked so; one that went out meanwhile can't be archived and stays.
async function takeBackUpcomingPosts(session: SessionContext): Promise<void> {
  for (const slot of await upcomingPostingTimes(session.companyId)) {
    const archived = slot.draftId ? (await archiveContentDraft(session.companyId, session.userId, slot.draftId)) === "changed" : true;
    if (archived) {
      await finishPostingTime(session.companyId, slot.id, { status: "skipped", reason: "stopped", attempts: 0 });
    }
  }
}
