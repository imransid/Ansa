import type { ReactNode } from "react";
import Link from "next/link";
import { labelOfTopic } from "@/lib/business-facts";
import type { MissingPlanFact } from "@/services/marketing-strategy";

type MissingFactsProps = {
  missing: MissingPlanFact[];
  isOwner: boolean;
  // What the AI would write: "a plan" (Strategy, step 37), "a draft" (the
  // content studio, step 38).
  writes: string;
  // A line of the page's own, after the rest (what can be done meanwhile).
  children?: ReactNode;
};

// What the Co-Founder still needs before it can write a plan or a draft:
// each missing fact, linked to its topic on the Profile page. Until they are
// confirmed the AI is never asked: it could only guess.
export function MissingFacts({ missing, isOwner, writes, children }: MissingFactsProps) {
  return (
    <div className="grid gap-2 rounded-lg border p-3 text-sm">
      <p>
        {isOwner ? `Before the Co-Founder can write ${writes}, confirm` : `Before the Co-Founder can write ${writes}, an owner needs to confirm`}{" "}
        {missing.length === 1 ? "this fact" : "these facts"}:
      </p>
      <ul className="grid list-disc gap-1 pl-5">
        {missing.map((fact) => (
          <li key={fact.label}>
            <MissingFactLinks fact={fact} />
          </li>
        ))}
      </ul>
      {isOwner ? <HowToConfirmThem /> : <OnlyOwnersConfirmThem />}
      {children}
    </div>
  );
}

function HowToConfirmThem() {
  return (
    <p className="text-muted-foreground">
      Answer the{" "}
      <Link href="/cofounder/interview" className="underline">
        interview
      </Link>
      , or fill them in on the{" "}
      <Link href="/cofounder/profile" className="underline">
        Profile page
      </Link>
      . A proposal waiting there counts once an owner confirms it.
    </p>
  );
}

// Members get no answer box or buttons on those pages, only what is there.
function OnlyOwnersConfirmThem() {
  return (
    <p className="text-muted-foreground">
      Only owners answer the interview and confirm facts. You can read both:{" "}
      <Link href="/cofounder/interview" className="underline">
        the interview
      </Link>{" "}
      and the{" "}
      <Link href="/cofounder/profile" className="underline">
        Profile page
      </Link>
      .
    </p>
  );
}

// One topic: its label as the link. Several (products or services): the
// label, then a link to each, any of which is enough.
function MissingFactLinks({ fact }: { fact: MissingPlanFact }) {
  if (fact.topics.length === 1) {
    return <TopicLink topic={fact.topics[0]} label={fact.label} />;
  }
  return (
    <>
      {fact.label} (one is enough):{" "}
      {fact.topics.map((topic, index) => (
        <span key={topic}>
          {index > 0 && ", "}
          <TopicLink topic={topic} label={labelOfTopic(topic)} />
        </span>
      ))}
    </>
  );
}

function TopicLink({ topic, label }: { topic: string; label: string }) {
  return (
    <Link href={`/cofounder/profile#topic-${topic}`} className="underline">
      {label}
    </Link>
  );
}
