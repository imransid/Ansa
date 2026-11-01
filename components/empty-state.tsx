import type { ReactNode } from "react";

// What a list shows when it has nothing to list (step 44): a sentence or two,
// often with a link to what to do next, on a quiet tint instead of an empty
// table. No icon: the words say it.
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="grid justify-items-center rounded-2xl bg-muted/60 px-6 py-12 text-center">
      <p className="max-w-md text-[0.9375rem] leading-6 text-muted-foreground">{children}</p>
    </div>
  );
}
