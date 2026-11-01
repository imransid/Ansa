import { setAssistantStatusAction, setAwayAction } from "@/app/actions/away";
import { ActionButton } from "@/components/action-button";
import { briefingSentence } from "@/lib/home-briefing";
import type { Presence } from "@/services/away";

type StatusCardProps = {
  presence: Presence;
  // What waits for someone (Home's "Needs you"): app/dashboard/needs-you.tsx.
  waiting: { peopleWaiting: number; otherThingsWaiting: number };
  openTickets: number;
};

// The signature of Home (step 44; since the "easy to use" pass of 2026-11-01
// it says what ansa is doing right now): a deep green card with a fine brass
// rule inside its edge, like a printed menu. One sentence for what ansa
// does, one for what waits, and the one button that changes it (owners).
export function StatusCard({ presence, waiting, openTickets }: StatusCardProps) {
  const now = describeNow(presence);
  return (
    <section
      aria-labelledby="status-heading"
      className="relative grid gap-6 overflow-hidden rounded-[1.25rem] bg-(image:--briefing) p-6 text-ivory shadow-float after:pointer-events-none after:absolute after:inset-[7px] after:rounded-[0.875rem] after:border after:border-brass/30 md:grid-cols-[1fr_auto] md:items-end md:p-8"
    >
      <div className="grid gap-3">
        <h2 id="status-heading" className="text-sm text-brass">
          Right now
        </h2>
        <p className="max-w-[26ch] font-display text-[1.75rem] leading-[2.125rem] text-balance">{now.sentence}</p>
        <p className="max-w-[48ch] text-ivory/85">
          {now.detail} {briefingSentence({ ...waiting, openTickets })}
        </p>
      </div>
      {presence.canManage && now.button && (
        // relative: above the card's brass rule, which would take the clicks.
        <div className="relative">
          <ActionButton action={now.button.action} fields={now.button.fields} label={now.button.label} accessibleLabel={now.button.accessibleLabel} look="on-green" />
        </div>
      )}
    </section>
  );
}

type Now = {
  sentence: string;
  detail: string;
  button: {
    action: typeof setAwayAction;
    fields: Record<string, string>;
    label: string;
    accessibleLabel: string;
  } | null;
};

const PAUSE = { action: setAssistantStatusAction, fields: { status: "paused" }, label: "Pause ansa", accessibleLabel: "Pause ansa: it answers nobody until you turn it on" };

// What ansa does right now, and the one change that makes sense from here.
function describeNow(presence: Presence): Now {
  const { availability, awayNow } = presence;
  if (presence.status === "paused") {
    return {
      sentence: "ansa is paused.",
      detail: "It answers nobody until you turn it back on.",
      button: { action: setAssistantStatusAction, fields: { status: "on" }, label: "Turn ansa on", accessibleLabel: "Turn ansa on: it answers again" },
    };
  }
  if (availability.answerWhen === "always") {
    return {
      sentence: presence.kind === "personal" ? "ansa answers every message for you." : "ansa answers every customer.",
      detail: "Anything it isn't sure of comes to you.",
      button: PAUSE,
    };
  }
  if (availability.awaySince) {
    return {
      sentence: "You're away. ansa is answering for you.",
      detail: "It tells you what you missed when you're back.",
      button: { action: setAwayAction, fields: { away: "off" }, label: "I'm back", accessibleLabel: "I'm back: ansa stops answering for me" },
    };
  }
  if (awayNow) {
    return { sentence: "It's one of your away times. ansa is answering for you.", detail: "It stops by itself when they end.", button: PAUSE };
  }
  return {
    sentence: "You're available. You answer your messages.",
    detail: availability.replyGraceMinutes
      ? `If you haven't answered within ${availability.replyGraceMinutes} minutes, ansa does.`
      : "Press “I'm away” when you can't answer, and ansa takes over.",
    button: { action: setAwayAction, fields: { away: "on" }, label: "I'm away", accessibleLabel: "I'm away: ansa answers for me now" },
  };
}
