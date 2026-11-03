import Link from "next/link";
import { Badge } from "@/components/ui/badge";

// A development stand-in account on Settings → Connections: named by what
// it is, with one "Development stand-in" tag as the rest of the app marks
// stand-ins (core's own names for them say "stand-in" already, so adding a
// second mark said it twice).
export function StandInName({ name }: { name: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-medium">{name}</span>
      <Badge variant="outline">Development stand-in</Badge>
    </span>
  );
}

// What to do with a stand-in account: be one of its customers, or the
// business answering from its own app, in the practice chat. For one
// person (step 50): someone writing to them, or they answering themselves.
export function PracticeChatAdvice({ connected, personal }: { connected: boolean; personal: boolean }) {
  return (
    <p className="text-sm text-muted-foreground">
      {practiceChatWords(connected, personal)}
      <Link href="/settings/channels/practice-chat" className="text-link hover:underline">
        practice chat
      </Link>
      . ansa&apos;s replies are written to .dev-messages/.
    </p>
  );
}

function practiceChatWords(connected: boolean, personal: boolean): string {
  const writer = personal ? "someone writing to you" : "a customer";
  if (!connected) {
    return `Once it is connected, write to it as ${writer} in the `;
  }
  const answerer = personal ? "answer as yourself from your own app" : "answer as the business from its own app";
  return `Write to it as ${writer}, or ${answerer}, in the `;
}
