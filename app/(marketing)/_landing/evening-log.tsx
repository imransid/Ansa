import { StatusDot, type StatusTone } from "@/components/status-dot";

// "A day with ansa" (rewritten 2026-11-01): one example person's day, set
// like a log: what came in, on which channel, and what ansa did. The notes
// are part of the story on purpose: knowing what needs you is the product.
// An example, and labelled so: no real person or numbers. Every line is
// something ansa does today (Telegram, email forwarding, Home).
const DAY: { time: string; channel: string; asked: string; did: string; tone: StatusTone; outcome: string }[] = [
  { time: "09:12", channel: "Telegram", asked: "“Are you free for a new project in March?”", did: "Said Maya is in workshops today, and noted the dates.", tone: "attention", outcome: "Note for Maya" },
  { time: "11:40", channel: "Telegram", asked: "“What are your rates for a logo?”", did: "Answered from the price list Maya gave it.", tone: "success", outcome: "Answered" },
  { time: "13:05", channel: "Email", asked: "An email about last month's invoice.", did: "Kept it as a note, with what the client asked.", tone: "attention", outcome: "Note for Maya" },
  { time: "18:20", channel: "Telegram", asked: "“Where is your studio?”", did: "Gave the address from Maya's details.", tone: "success", outcome: "Answered" },
  { time: "23:47", channel: "Telegram", asked: "“Sorry it's late! Can we meet on Tuesday?”", did: "Booked nothing. Said Maya will confirm, and noted it.", tone: "attention", outcome: "Note for Maya" },
  { time: "08:00", channel: "Home", asked: "Good morning.", did: "“While you were away: 6 answered, 3 need you.”", tone: "info", outcome: "Summary" },
];

export function EveningLog() {
  return (
    <section className="bg-sheet">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-24 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
        <div className="grid content-start gap-4">
          <p className="text-sm text-subtle-foreground">An example day</p>
          <h2 className="font-display text-4xl leading-tight font-[340] tracking-[-0.03em] sm:text-5xl">A day with ansa.</h2>
          <p className="max-w-[38ch] text-muted-foreground">
            Maya, a designer, is in workshops all day. ansa answers what it knows, commits Maya to nothing, and keeps a note of everything
            that needs Maya.
          </p>
        </div>
        <ol className="divide-y border-y">
          {DAY.map((entry) => (
            <li key={entry.time} className="grid gap-1 py-4 sm:grid-cols-[5rem_1fr_auto] sm:items-baseline sm:gap-6">
              <span className="font-display text-2xl text-link numbers">{entry.time}</span>
              <span className="grid gap-0.5">
                <span className="text-sm text-subtle-foreground">{entry.channel}</span>
                <span className="font-semibold">{entry.asked}</span>
                <span className="text-muted-foreground">{entry.did}</span>
              </span>
              <StatusDot tone={entry.tone} className="sm:justify-self-end">
                {entry.outcome}
              </StatusDot>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
