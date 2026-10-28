import { LocalDateTime } from "@/components/local-date-time";
import { INTERVIEW_MESSAGES_SHOWN } from "@/lib/cofounder/limits";
import { cn } from "@/lib/utils";
import type { Interview, InterviewMessage } from "@/services/onboarding-interview";

// The interview so far (step 36), oldest first and the newest at the bottom,
// like a chat: the Co-Founder's questions on the left, the owners' answers
// on the right. Before the first answer it shows the opening question, which
// is saved together with that answer.
export function Conversation({ interview }: { interview: Interview }) {
  return (
    <section className="grid gap-3" aria-label="The interview so far">
      {interview.olderMessagesHidden && (
        <p className="text-sm text-muted-foreground">
          Only the newest {INTERVIEW_MESSAGES_SHOWN} messages are shown. The facts from older answers are on the Profile
          page.
        </p>
      )}
      <ol className="grid gap-3">
        {interview.messages.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}
        {interview.opening && (
          <li className={bubbleClass(false)}>
            <p className="text-xs font-medium">Co-Founder</p>
            <p className="whitespace-pre-wrap wrap-anywhere">{interview.opening.text}</p>
          </li>
        )}
      </ol>
      {interview.finished && (
        <p role="status" className="rounded-lg border p-3 text-sm">
          The interview covered every key fact. Confirm, edit or dismiss what was proposed on the Profile page. You can
          still answer below to add details.
        </p>
      )}
    </section>
  );
}

function MessageItem({ message }: { message: InterviewMessage }) {
  const fromOwner = message.author === "owner";
  return (
    <li className={bubbleClass(fromOwner)}>
      <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{fromOwner ? (message.authorName ?? "An owner") : "Co-Founder"}</span>
        <LocalDateTime iso={message.createdAt.toISOString()} />
      </p>
      {message.unreadable ? (
        <p className="text-muted-foreground italic">This message could not be decrypted.</p>
      ) : (
        <p className="whitespace-pre-wrap wrap-anywhere">{message.text}</p>
      )}
    </li>
  );
}

// At most 85% wide, so who wrote what shows at a glance, on a phone too.
function bubbleClass(fromOwner: boolean): string {
  return cn("grid max-w-[85%] gap-1 rounded-lg border p-3 text-sm", fromOwner ? "justify-self-end bg-muted" : "justify-self-start");
}
