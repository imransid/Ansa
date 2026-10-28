import { composePublishedText, PLATFORM_RULES, type DraftContent } from "@/lib/content-rules";
import { SOCIAL_PLATFORM_LABELS } from "@/lib/social-platforms";
import { COUNTING_UNITS, measureText } from "./text-measure";

// The counts the editor shows while someone types (step 38), one per limit
// of the draft's platform: the title (YouTube), the text it publishes, and
// the hashtags. Pure, counted exactly as lib/content-rules.ts counts.

export type ContentMeasure = {
  label: string;
  used: number;
  max: number;
  // "characters as X counts them", "bytes", "" for hashtags.
  unit: string;
  over: boolean;
  // What the count includes, or the platform's advice; null: nothing to add.
  note: string | null;
};

// Every count of one draft, in the order the editor shows its fields.
export function measureDraftContent(draft: DraftContent): ContentMeasure[] {
  const rules = PLATFORM_RULES[draft.platform];
  const measures: ContentMeasure[] = [];
  if (rules.title) {
    const used = measureText(draft.title.trim(), "characters");
    measures.push({ label: "Title", used, max: rules.title.max, unit: "characters", over: used > rules.title.max, note: null });
  }
  const textUsed = measureText(composePublishedText(draft), rules.text.counting);
  measures.push({
    label: rules.text.label,
    used: textUsed,
    max: rules.text.max,
    unit: COUNTING_UNITS[rules.text.counting],
    over: textUsed > rules.text.max,
    note: "call to action and hashtags included",
  });
  const recommended = rules.hashtags.recommendedMax;
  measures.push({
    label: "Hashtags",
    used: draft.hashtags.length,
    max: rules.hashtags.max,
    unit: "",
    over: draft.hashtags.length > rules.hashtags.max,
    note: recommended === null ? null : `${SOCIAL_PLATFORM_LABELS[draft.platform]} recommends no more than ${recommended}`,
  });
  return measures;
}
