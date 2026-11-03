import "server-only";
import { callCore } from "@/lib/core-api";
import { coreFormErrors } from "@/lib/core-views/restaurant-setup";
import type { FormErrors } from "@/lib/form-result";
import type { AutopostPage, PostedSlot } from "@/lib/types/autopost";

// Settings → Posts for me through the new backend (core's
// /api/v1/settings/posts), in the shapes the page and its forms already read.

type CoreSlot = Omit<PostedSlot, "postAt"> & { postAt: string };

type CorePostsPage = {
  page: Omit<AutopostPage, "canManage" | "nextTimes" | "slots"> & { nextTimes: string[]; slots: CoreSlot[] };
  canManage: boolean;
};

// The switch, the Pages, the next three posting times and the newest 20 posts.
export async function getAutopostPageFromCore(): Promise<AutopostPage> {
  const answer = await callCore<CorePostsPage>("GET", "/api/v1/settings/posts");
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  const { page, canManage } = answer.data;
  return {
    canManage,
    enabled: page.enabled,
    frequency: page.frequency,
    time: page.time,
    mode: page.mode,
    timeZone: page.timeZone,
    pages: page.pages,
    nextTimes: page.nextTimes.map((time) => new Date(time)),
    slots: page.slots.map((slot) => ({ ...slot, postAt: new Date(slot.postAt) })),
    isBusy: page.isBusy,
  };
}

// Saves the switch: how often, what time, Automatic or Ask me first.
export async function saveAutopostThroughCore(formData: FormData): Promise<{ ok: true } | { ok: false; errors: FormErrors }> {
  const answer = await callCore("POST", "/api/v1/settings/posts", {
    enabled: formData.get("enabled") === "on",
    frequency: textOf(formData, "frequency"),
    time: textOf(formData, "time"),
    mode: textOf(formData, "mode"),
    // The owner's tick: posts go out without anyone approving each one.
    understood: formData.get("understood") === "on",
  });
  return answer.ok ? { ok: true } : { ok: false, errors: coreFormErrors(answer) };
}

// "Post one now": core writes it and, in Automatic, sends it itself right after its answer.
export async function postNowThroughCore(): Promise<{ ok: true } | { ok: false; errors: FormErrors }> {
  const answer = await callCore("POST", "/api/v1/settings/posts/now");
  return answer.ok ? { ok: true } : { ok: false, errors: coreFormErrors(answer) };
}

// A form value as the forms send it: text, or nothing.
function textOf(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
