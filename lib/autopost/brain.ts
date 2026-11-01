import type { BusinessType, CompanyKind } from "@/lib/restaurant-setup";

// ansa's own choice of what to post next (step 54), so the owner never
// gives it a topic. A mix of kinds of posts that suits the business, the
// days that matter (a holiday, the weekend), no repeats, and more of what
// people liked: each kind's weight grows or shrinks with its posts'
// reactions, comments and shares. The AI then only writes the post. Pure.

export const POST_KINDS = ["spotlight", "behind_the_scenes", "question", "visit_us", "tip", "special_day"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const POST_KIND_LABELS: Record<PostKind, string> = {
  spotlight: "Something you offer",
  behind_the_scenes: "Behind the scenes",
  question: "A question for followers",
  visit_us: "Come and see us",
  tip: "A useful tip",
  special_day: "A special day",
};

// How often each kind comes up, before what people liked changes it.
const FOOD_MIX: Record<Exclude<PostKind, "special_day">, number> = { spotlight: 4, behind_the_scenes: 2, question: 2, visit_us: 2, tip: 1 };
const OTHER_MIX: Record<Exclude<PostKind, "special_day">, number> = { spotlight: 3, tip: 3, behind_the_scenes: 2, question: 1, visit_us: 2 };
const FOOD_TYPES: BusinessType[] = ["restaurant", "cafe", "bakery", "takeaway", "food_truck", "bar", "catering"];

// Days most businesses post about, by month and day.
export const SPECIAL_DAYS: { month: number; day: number; name: string }[] = [
  { month: 1, day: 1, name: "New Year's Day" },
  { month: 2, day: 14, name: "Valentine's Day" },
  { month: 3, day: 8, name: "International Women's Day" },
  { month: 10, day: 31, name: "Halloween" },
  { month: 12, day: 24, name: "Christmas Eve" },
  { month: 12, day: 25, name: "Christmas Day" },
  { month: 12, day: 31, name: "New Year's Eve" },
];

export type PastPost = {
  kind: PostKind;
  // The dish, product or service it was about ("" for none).
  itemName: string;
  specialDay: string;
  // Reactions + comments + shares, or null when no numbers were read yet.
  engagement: number | null;
};

export type BrainInput = {
  kind: CompanyKind;
  businessType: BusinessType | null;
  // What the business offers today (dishes, products, services), by name.
  items: string[];
  // The local date of the post ("2026-12-24") and its weekday ("Friday").
  date: string;
  weekday: string;
  // Newest first.
  history: PastPost[];
  // Kinds to leave out this time (one that just failed ansa's checks).
  skip?: PostKind[];
};

export type PostChoice = { kind: PostKind; itemName: string; specialDay: string; topic: string };

export function chooseNextPost(input: BrainInput): PostChoice {
  const specialDay = specialDayOn(input.date);
  if (specialDay && !input.skip?.includes("special_day") && !input.history.some((post) => post.specialDay === specialDay)) {
    return { kind: "special_day", itemName: "", specialDay, topic: `${specialDay}` };
  }
  const kind = pickKind(input);
  const itemName = kind === "spotlight" ? leastRecentItem(input.items, input.history) : "";
  return { kind, itemName, specialDay: "", topic: topicFor(kind, itemName, input.weekday) };
}

// The kind with the highest score: its share of the mix, times how well its
// posts did compared with all posts, lowered for each of the last few
// posts it was already used in.
function pickKind(input: BrainInput): PostKind {
  const mix = input.businessType && FOOD_TYPES.includes(input.businessType) ? FOOD_MIX : OTHER_MIX;
  const average = averageEngagement(input.history);
  let best: { kind: PostKind; score: number } | null = null;
  for (const [kind, weight] of Object.entries(mix) as [Exclude<PostKind, "special_day">, number][]) {
    if (input.skip?.includes(kind) || (kind === "spotlight" && input.items.length === 0)) {
      continue;
    }
    const recentUses = input.history.slice(0, 3).filter((post) => post.kind === kind).length;
    const kindAverage = averageEngagement(input.history.filter((post) => post.kind === kind));
    const liked = average && kindAverage !== null ? clamp(kindAverage / average, 0.5, 2) : 1;
    // The weekend: a "come and see us" post sells best on Thursday and Friday.
    const timing = kind === "visit_us" && (input.weekday === "Thursday" || input.weekday === "Friday") ? 1.5 : 1;
    const score = (weight * liked * timing) / (1 + recentUses * 2);
    if (!best || score > best.score) {
      best = { kind, score };
    }
  }
  return best?.kind ?? "tip";
}

// The item whose last spotlight is the oldest (never spotlighted first, in
// the menu's order).
function leastRecentItem(items: string[], history: PastPost[]): string {
  let best = items[0] ?? "";
  let bestAge = -1;
  for (const item of items) {
    const lastUse = history.findIndex((post) => post.kind === "spotlight" && post.itemName === item);
    const age = lastUse === -1 ? Number.MAX_SAFE_INTEGER : lastUse;
    if (age > bestAge) {
      best = item;
      bestAge = age;
    }
  }
  return best;
}

function topicFor(kind: PostKind, itemName: string, weekday: string): string {
  switch (kind) {
    case "spotlight":
      return itemName;
    case "visit_us":
      return weekday === "Thursday" || weekday === "Friday" ? "The weekend is coming: come and see us" : "Come and see us";
    case "question":
      return "A question for our followers";
    case "behind_the_scenes":
      return "Behind the scenes";
    default:
      return "A useful tip from us";
  }
}

export function specialDayOn(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return SPECIAL_DAYS.find((special) => special.month === month && special.day === day)?.name ?? "";
}

function averageEngagement(posts: PastPost[]): number | null {
  const counted = posts.map((post) => post.engagement).filter((value): value is number => value !== null);
  return counted.length === 0 ? null : counted.reduce((sum, value) => sum + value, 0) / counted.length;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
