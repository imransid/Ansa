import { Badge } from "@/components/ui/badge";
import type { CheckedClaim } from "@/lib/content-studio/claims";
import type { DraftReview } from "@/lib/content-studio/review";

// The claims of the saved version (step 38): what its text says about the
// business that someone could check, each marked backed or not. The AI
// listed them; this app decided which a confirmed fact backs
// (lib/content-studio/claims.ts), and checks again whether those facts
// changed since. Text from the AI is shown as text, never as HTML.
export function DraftClaims({ review, generatedVersion }: { review: DraftReview; generatedVersion: number | null }) {
  return (
    <section className="grid gap-3" aria-labelledby="draft-claims">
      <h3 id="draft-claims" className="font-semibold">
        Claims
      </h3>
      <ClaimsState review={review} generatedVersion={generatedVersion} />
      {review.claims.length > 0 && (
        <ul className="grid gap-2">
          {review.claims.map((claim, index) => (
            <li key={index} className="grid gap-1 rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-start gap-2">
                <Badge variant={claim.status === "backed" ? "default" : "destructive"}>{claim.status === "backed" ? "Backed" : "Not backed"}</Badge>
                <p className="min-w-0 flex-1 wrap-anywhere">{claim.text}</p>
              </div>
              <p className="text-xs text-muted-foreground wrap-anywhere">{describeClaim(claim)}</p>
            </li>
          ))}
        </ul>
      )}
      {review.acknowledgmentNeeded && (
        <p className="text-sm">
          An owner approves this draft only after ticking &ldquo;I checked these claims&rdquo;: read the text and make sure
          every claim it makes is true.
        </p>
      )}
    </section>
  );
}

function ClaimsState({ review, generatedVersion }: { review: DraftReview; generatedVersion: number | null }) {
  switch (review.claimsState) {
    case "written_by_hand":
      return (
        <p className="text-sm text-muted-foreground">
          Nobody listed this draft&apos;s claims: the AI didn&apos;t write its text. Check every claim it makes about your
          business (prices, features, numbers, results, dates, offers) before approving it.
        </p>
      );
    case "edited":
      return (
        <p className="text-sm text-muted-foreground">
          The AI listed these for version {generatedVersion}; the text was changed by hand since, so a claim someone added
          isn&apos;t listed. Check the text as it is now.
        </p>
      );
    case "current":
      return (
        <p className="text-sm text-muted-foreground">
          {review.claims.length === 0
            ? "The AI found no claim about your business in this text."
            : "What the text says about your business that someone could check. The AI listed them; this app checked which a fact confirmed on the Profile page backs."}
        </p>
      );
  }
}

function describeClaim(claim: CheckedClaim): string {
  const labels = claim.facts.map((fact) => fact.label).join(", ");
  switch (claim.status) {
    case "backed":
      return `Backed by: ${claim.facts.map((fact) => `${fact.label} ("${fact.value}")`).join("; ")}`;
    case "no_fact":
      return "No confirmed fact says this.";
    case "fact_not_confirmed":
      return `It relies on ${labels}, which wasn't confirmed when the draft was written.`;
    case "fact_changed":
      return `${labels} changed on the Profile page since the draft was written.`;
  }
}
