import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// What each colour means (step 44). Always shown with words: the colour only
// helps the eye, it never carries the meaning alone.
const TONES = {
  attention: "text-attention", // needs you
  info: "text-info", // new
  success: "text-success", // done, answering, all clear
  problem: "text-destructive", // failed, not delivered
  quiet: "text-muted-foreground",
} as const;

export type StatusTone = keyof typeof TONES;

// A status as a small dot and its words ("Needs you", "Done"), instead of a
// coloured pill.
export function StatusDot({ tone, children, className }: { tone: StatusTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm", TONES[tone], className)}>
      <span aria-hidden className="size-1.75 shrink-0 rounded-full bg-current" />
      <span>{children}</span>
    </span>
  );
}
