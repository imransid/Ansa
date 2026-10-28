import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { startOverInterviewAction } from "@/app/actions/cofounder";
import { ConfirmButton } from "@/components/confirm-button";
import { canManageBusinessProfile } from "@/lib/cofounder/permissions";
import { requireSessionContext } from "@/lib/session";
import { getInterviewForSession } from "@/services/onboarding-interview";
import { AnswerForm } from "./answer-form";
import { Conversation } from "./conversation";

export const metadata: Metadata = { title: "Interview - Co-Founder - ansa" };

// Every answer asks Claude inside this page's server action (up to 2 tries of
// 40 s): the host's default time limit can be as short as 10 seconds.
export const maxDuration = 300;

// From this many messages on, a link at the top jumps to the answer box.
const MESSAGES_BEFORE_JUMP_LINK = 6;

export default function InterviewPage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      {/* Cache Components rule: the session is only known at request time,
          so it is read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <InterviewContent />
      </Suspense>
    </main>
  );
}

// The Co-Founder's interview (step 36): the conversation so far, kept in the
// database, so it goes on where it was left. Owners answer; members read.
async function InterviewContent() {
  const session = await requireSessionContext("/cofounder/interview");
  const interview = await getInterviewForSession(session);
  // Hiding the box and the button is only for a tidy page: the services
  // and /db refuse members.
  const isOwner = canManageBusinessProfile(session.role);
  const hasMessages = interview.messages.length > 0;

  return (
    <>
      <section className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-xl font-semibold">Interview</h1>
          {isOwner && hasMessages && (
            <ConfirmButton
              action={startOverInterviewAction}
              fields={{}}
              label="Start over"
              question="Delete the whole conversation and start the interview again? The facts and proposals on the Profile page stay."
              confirmLabel="Yes, start over"
              pendingLabel="Deleting..."
            />
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          The Co-Founder asks one question at a time, about what it still needs to know. What it reads from an answer
          becomes a proposed fact on the{" "}
          <Link href="/cofounder/profile" className="underline">
            Profile page
          </Link>
          , and nothing counts until an owner confirms it. Stop whenever you like: it goes on where you left off.
        </p>
        {isOwner && interview.messages.length >= MESSAGES_BEFORE_JUMP_LINK && (
          <a href="#interview-answer" className="text-sm underline">
            Go to the answer box
          </a>
        )}
      </section>

      <Conversation interview={interview} />

      {isOwner ? (
        <AnswerForm openingTopic={interview.opening ? (interview.opening.topic ?? "none") : undefined} />
      ) : (
        <p className="text-sm text-muted-foreground">Only owners answer the interview. You can read it here.</p>
      )}
    </>
  );
}
