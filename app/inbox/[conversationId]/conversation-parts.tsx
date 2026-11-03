import Link from "next/link";
import { setImportantAction } from "@/app/actions/away";
import { answerNowAction, discardDraftAction, handBackAction, sendDraftAction, takeOverAction } from "@/app/actions/conversations";
import { ActionButton } from "@/components/action-button";
import { ConfirmButton } from "@/components/confirm-button";
import { LocalDateTime } from "@/components/local-date-time";
import { StatusDot } from "@/components/status-dot";
import { buttonVariants } from "@/components/ui/button";
import { HANDOVER_REASON_TEXT } from "@/lib/assistant/reasons";
import { ACTIVITY_TEXT } from "@/lib/conversations";
import type { ConversationView } from "@/lib/core-views/inbox";

// The smaller parts of one conversation's page (step 47): the assistant's
// waiting reply, someone marked important, when ansa steps in, who answers
// it, and its history.

// The assistant's reply waiting for a person ("Ask me first", step 49):
// send it as written, edit it in the reply box, or discard it.
export function WaitingReply({ conversationId, messageId }: { conversationId: string; messageId: string }) {
  const fields = { conversationId, messageId };
  return (
    <div className="grid gap-2 rounded-2xl border p-4">
      <StatusDot tone="info">ansa wrote a reply. It waits for you.</StatusDot>
      <div className="flex flex-wrap items-start gap-2">
        <ActionButton action={sendDraftAction} fields={fields} label="Send" accessibleLabel="Send ansa's reply as written" />
        <Link href={`/inbox/${conversationId}?edit=${messageId}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Edit
        </Link>
        <ConfirmButton
          action={discardDraftAction}
          fields={fields}
          label="Discard"
          accessibleLabel="Discard ansa's reply"
          question="Discard ansa's reply? The customer never gets it."
          confirmLabel="Discard"
          pendingLabel="Discarding..."
        />
      </div>
    </div>
  );
}

// Someone marked important (step 51) always comes to you: ansa never
// answers them itself.
export function Importance({ conversationId, important }: { conversationId: string; important: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm text-muted-foreground">
        {important ? "Important: ansa never answers them itself, it tells you at once." : "ansa may answer them for you."}
      </span>
      <ActionButton
        action={setImportantAction}
        fields={{ conversationId, important: important ? "off" : "on" }}
        label={important ? "Not important" : "Mark important"}
        accessibleLabel={important ? "Let ansa answer this person again" : "Mark this person important: they always come to you"}
      />
    </div>
  );
}

// "If I haven't answered within N minutes" (step 51): ansa waits for your
// reply and answers by itself at its time. In development an owner may let
// it answer now, at the scheduler's next round (core refuses it elsewhere).
export function AnswersAt({ conversationId, dueAt, canAnswerNow }: { conversationId: string; dueAt: Date; canAnswerNow: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <StatusDot tone="info">
        ansa answers at <LocalDateTime iso={dueAt.toISOString()} timeOnly /> unless you reply
      </StatusDot>
      {canAnswerNow && (
        <ActionButton
          action={answerNowAction}
          fields={{ conversationId }}
          label="Answer now"
          accessibleLabel="Let ansa answer now instead of waiting (development only)"
        />
      )}
    </div>
  );
}

// Who answers this conversation, and the button that changes it.
export function Handler({ conversation }: { conversation: ConversationView }) {
  const fields = { conversationId: conversation.id };
  if (conversation.handledBy === "person") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <StatusDot tone="info">
          Taken over by {conversation.takenOverByName ?? "a teammate"}
          {conversation.takenOverAt && (
            <>
              {" "}
              on <LocalDateTime iso={conversation.takenOverAt.toISOString()} />
            </>
          )}
        </StatusDot>
        <ActionButton action={handBackAction} fields={fields} label="Hand back to ansa" accessibleLabel="Hand this conversation back to ansa" />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* While a request is open, ansa stays quiet here (step 49): a person
          answers next, and the request's Done gives it back. */}
      {conversation.openTicket ? (
        <StatusDot tone="attention">You answer next: ansa stays quiet until you press Done</StatusDot>
      ) : (
        <>
          <StatusDot tone="success">ansa handles this conversation</StatusDot>
          <ActionButton action={takeOverAction} fields={fields} label="Take over" accessibleLabel="Take this conversation over from ansa" />
        </>
      )}
    </div>
  );
}

export function History({ activity }: { activity: ConversationView["activity"] }) {
  if (activity.length === 0) {
    return null;
  }
  return (
    <section className="grid gap-2 text-sm">
      <h2 className="font-semibold">History</h2>
      <ol className="grid gap-1 text-muted-foreground">
        {activity.map((row) => (
          <li key={row.id}>
            <LocalDateTime iso={row.createdAt.toISOString()} />: {ACTIVITY_TEXT[row.action]}
            {row.reason ? `. ${HANDOVER_REASON_TEXT[row.reason]}` : ""}
            {row.actorName ? ` (${row.actorName})` : ""}
          </li>
        ))}
      </ol>
    </section>
  );
}
