import type { PostKind } from "@/lib/autopost/brain";
import type { AutopostFrequency, AutopostMode } from "@/lib/autopost/schedule";
import type { AutopostSlotStatus, SkipReason } from "@/lib/autopost/slots";

// "Post for me" (step 54) as Settings → Posts for me shows it: the owner's
// switch, the next posting times, and ansa's newest posts with where each is.

export type PostedSlot = {
  id: string;
  postAt: Date;
  status: AutopostSlotStatus;
  kind: PostKind;
  topic: string;
  itemName: string;
  specialDay: string;
  skipReason: SkipReason | null;
  draftId: string | null;
  draftStatus: string | null;
  body: string | null;
  // Reactions + comments + shares in the post's newest numbers, or null.
  engagement: number | null;
  // Those numbers were simulated (development), and the list says so.
  engagementSimulated: boolean;
};

export type AutopostPage = {
  canManage: boolean;
  enabled: boolean;
  frequency: AutopostFrequency;
  // "HH:MM" in the business's time zone.
  time: string;
  mode: AutopostMode;
  timeZone: string | null;
  // The names of the business's connected Facebook Pages.
  pages: string[];
  // The next three posting times (none while it is off or has no time zone).
  nextTimes: Date[];
  // ansa's newest 20 posts.
  slots: PostedSlot[];
  // A post is about to go out (due within the next minute, or a moment
  // ago and not out yet): the page refreshes itself until it shows posted.
  isBusy: boolean;
};
