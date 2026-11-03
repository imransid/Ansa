import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import { StatusDot, type StatusTone } from "@/components/status-dot";
import { SIMULATED_LABEL } from "@/lib/analytics/kinds";
import type { PostKind } from "@/lib/autopost/brain";
import type { SkipReason } from "@/lib/autopost/slots";
import type { PostedSlot } from "@/lib/types/autopost";

// The newest posts of "Post for me" (step 54): when, what about, where each
// is, its first lines, and how people liked it ("Simulated (development)"
// when those numbers were made up for a stand-in's post, as on every page).
export function PostedList({ slots, kindLabels, skipText }: { slots: PostedSlot[]; kindLabels: Record<PostKind, string>; skipText: Record<SkipReason, string> }) {
  if (slots.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing yet. Each post shows here, a day before it goes out.</p>;
  }
  return (
    <ol className="divide-y border-y">
      {slots.map((slot) => {
        const state = describe(slot, skipText);
        return (
          <li key={slot.id} className="grid gap-1 py-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">
                {kindLabels[slot.kind]}: {slot.topic}
              </span>
              <span className="text-xs text-subtle-foreground">
                <LocalDateTime iso={slot.postAt.toISOString()} />
              </span>
            </div>
            <StatusDot tone={state.tone}>{state.text}</StatusDot>
            {slot.body && <p className="line-clamp-2 text-muted-foreground">{slot.body}</p>}
            {slot.engagement !== null && (
              <p className="text-xs text-muted-foreground">
                {slot.engagement} reactions, comments and shares
                {slot.engagementSimulated && <span className="font-medium text-foreground">{` (${SIMULATED_LABEL})`}</span>}
              </p>
            )}
            {slot.draftId && (
              <Link href={`/cofounder/studio/${slot.draftId}`} className="justify-self-start text-xs underline">
                {slot.status === "waiting_approval" ? "Approve or change it" : "Open the post"}
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function describe(slot: PostedSlot, skipText: Record<SkipReason, string>): { tone: StatusTone; text: string } {
  if (slot.status === "skipped") {
    return { tone: "quiet", text: `Skipped. ${slot.skipReason ? skipText[slot.skipReason] : ""}` };
  }
  if (slot.status === "writing") {
    return { tone: "info", text: "Being written" };
  }
  if (slot.draftStatus === "published") {
    return { tone: "success", text: "Posted" };
  }
  if (slot.draftStatus === "failed") {
    return { tone: "problem", text: "Couldn't be posted: see Social media posts" };
  }
  if (slot.draftStatus === "archived") {
    return { tone: "quiet", text: "Taken back" };
  }
  return slot.status === "waiting_approval" ? { tone: "attention", text: "Waiting for your approval" } : { tone: "info", text: "Scheduled" };
}
