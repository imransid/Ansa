import Link from "next/link";
import type { AnswerWhen } from "@/lib/assistant/availability";
import { waitInWords } from "@/lib/devices";
import type { CompanyKind } from "@/lib/restaurant-setup";
import type { DevicesPage } from "@/lib/types/devices";
import { FollowPhoneForm } from "./follow-phone-form";

type FollowPhoneSectionProps = {
  page: DevicesPage;
  kind: CompanyKind;
  // "always": ansa answers everyone already, so the phone changes nothing.
  answerWhen: AnswerWhen;
};

// Settings → Your phone → "Answer for me when my phone is unreachable": what
// it does, what phones do to it, and the switch with its wait (owners;
// members read it).
export function FollowPhoneSection({ page, kind, answerWhen }: FollowPhoneSectionProps) {
  return (
    <div className="grid gap-3">
      <p className="text-sm">
        When none of your connected phones has checked in for the minutes you choose, ansa switches to away by itself and answers for
        you. When a phone checks in again, ansa switches back by itself. It never ends an &ldquo;I&apos;m away&rdquo; you pressed
        yourself.
      </p>
      <p className="text-sm text-muted-foreground">
        Phones pause apps in the background to save battery, so a phone left alone for a long time may count as unreachable even when
        it&apos;s on. A longer wait makes that rarer.
      </p>
      {answerWhen === "always" && <AnswersAlwaysNote kind={kind} />}
      {page.devices.length === 0 && <p className="text-sm text-muted-foreground">Connect a phone above first: until then this does nothing.</p>}
      {page.canChange ? (
        <FollowPhoneForm followPhone={page.followPhone} waitMinutes={page.waitMinutes} />
      ) : (
        <p className="text-sm">
          <span className="font-medium">Answer for me when my phone is unreachable:</span>{" "}
          {page.followPhone ? `on, after ${waitInWords(page.waitMinutes)} without a check-in` : "off"}. Only owners change it.
        </p>
      )}
    </div>
  );
}

// A business answering always (or a person who chose it): ansa answers
// everyone anyway, so being unreachable changes nothing until it answers
// only when you're away.
function AnswersAlwaysNote({ kind }: { kind: CompanyKind }) {
  return (
    <p className="rounded-xl bg-attention-surface px-4 py-3 text-sm">
      {kind === "personal" ? "ansa already answers every message for you" : "ansa already answers every customer"}, so your phone changes
      nothing here until ansa answers &ldquo;Only when I&apos;m away&rdquo; (
      <Link href="/settings/assistant#when-heading" className="font-medium underline">
        Settings → Assistant
      </Link>
      ).
    </p>
  );
}
