import type { ProfileCompletion } from "@/lib/cofounder/profile-status";

// "12 of 16 key facts confirmed", with a bar, and how many proposals wait
// for an owner. Only confirmed values count: a proposal is the AI's reading
// of what an owner said, not yet their word. The bar only repeats the
// sentence, so screen readers skip it.
export function ProfileCompletionSummary({ completion }: { completion: ProfileCompletion }) {
  const { keyConfirmed, keyTotal, proposalsWaiting } = completion;
  const percent = keyTotal === 0 ? 0 : Math.round((keyConfirmed / keyTotal) * 100);
  return (
    <div className="grid max-w-xl gap-2">
      <p className="text-sm">
        <strong>
          {keyConfirmed} of {keyTotal}
        </strong>{" "}
        key facts confirmed
        {proposalsWaiting > 0 && (
          <span className="text-muted-foreground">
            {" "}
            ({proposalsWaiting === 1 ? "1 proposal waits" : `${proposalsWaiting} proposals wait`} for an owner)
          </span>
        )}
      </p>
      <div aria-hidden className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
