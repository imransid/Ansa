import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import type { ProfileTopic } from "@/services/business-profile";
import { FactEditor } from "./fact-editor";
import { ProposalActions } from "./proposal-actions";

// One topic of the business profile (step 36): its confirmed value (or that
// it is missing), the AI's proposal waiting beside it, and for owners the
// buttons that handle them. The id lets the interview link to one topic.
export function TopicCard({ topic, isOwner }: { topic: ProfileTopic; isOwner: boolean }) {
  return (
    <li id={`topic-${topic.topic}`} className="grid scroll-mt-6 gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{topic.label}</h3>
        {topic.isKey && <Badge variant="outline">Key fact</Badge>}
      </div>
      <ConfirmedValue topic={topic} />
      {topic.proposal && <WaitingProposal topic={topic} proposal={topic.proposal} isOwner={isOwner} />}
      {isOwner && <FactEditor topic={topic.topic} label={topic.label} confirmedValue={topic.confirmed?.value ?? null} />}
    </li>
  );
}

function ConfirmedValue({ topic }: { topic: ProfileTopic }) {
  const confirmed = topic.confirmed;
  if (!confirmed) {
    return topic.isKey ? (
      <p className="text-sm font-medium text-destructive">Missing</p>
    ) : (
      <p className="text-sm text-muted-foreground">Not filled in</p>
    );
  }
  const who = confirmed.byName ?? "an owner";
  const how = confirmed.source === "owner" ? `Written by ${who}` : `Confirmed by ${who}, ${confirmed.source === "interview" ? "from the interview" : "from a knowledge article"}`;
  return (
    <div className="grid gap-1">
      <p className="text-sm whitespace-pre-wrap wrap-anywhere">{confirmed.value}</p>
      <p className="text-xs text-muted-foreground">
        {how}, <LocalDateTime iso={confirmed.at.toISOString()} dateOnly />
      </p>
    </div>
  );
}

type WaitingProposalProps = {
  topic: ProfileTopic;
  proposal: NonNullable<ProfileTopic["proposal"]>;
  isOwner: boolean;
};

// The AI's proposal, shown beside the confirmed value it would replace: it
// never replaces it on its own.
function WaitingProposal({ topic, proposal, isOwner }: WaitingProposalProps) {
  const heading = topic.confirmed ? "Proposed change" : "Proposed";
  const source = proposal.source === "interview" ? "from the interview" : "from a knowledge article";
  return (
    <div className="grid gap-2 rounded-md bg-muted p-3">
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{heading}</span> {source}, <LocalDateTime iso={proposal.at.toISOString()} dateOnly />
      </p>
      <p className="text-sm whitespace-pre-wrap wrap-anywhere">{proposal.value}</p>
      {isOwner ? (
        <ProposalActions topic={topic.topic} label={topic.label} proposal={proposal.value} confirmedValue={topic.confirmed?.value ?? null} />
      ) : (
        <p className="text-xs text-muted-foreground">Waiting for an owner to confirm or dismiss it.</p>
      )}
    </div>
  );
}
