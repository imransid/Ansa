import { ConciergeBell } from "lucide-react";
import { cn } from "@/lib/utils";

// The website's signature (2026-11-01): the "While you were away" summary
// ansa leaves you, set like a printed note. Fixed paper colours, so it reads
// the same on the green hero in light and dark mode. An example only.
const LINES: { who: string; what: string; status: "answered" | "needs" }[] = [
  { who: "Lena", what: "Asked for your rates. Answered from your price list.", status: "answered" },
  { who: "Sam", what: "Wants to move tomorrow's call to 3 pm.", status: "needs" },
  { who: "+44 7700 900123", what: "Called at 22:10. Took a note: a new project.", status: "needs" },
  { who: "Marco", what: "Said thanks for the quote. Replied with a thank-you.", status: "answered" },
];

export function AwayCard({ className }: { className?: string }) {
  return (
    <div
      aria-label="An example of what ansa tells you when you're back"
      className={cn("grid gap-3 rounded-2xl bg-[#fbf8f1] p-5 text-[#11211a] shadow-[0_18px_40px_rgb(4_20_13/0.35)] sm:p-6", className)}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-display text-xl">
          <ConciergeBell aria-hidden className="size-5 text-[#8a6a2e]" strokeWidth={1.6} />
          While you were away
        </span>
        <span className="text-xs text-[#55665d]">23:00 to 08:00</span>
      </div>
      <p className="text-sm text-[#55665d]">Good morning, Rafa. ansa answered 9 messages. 2 things need you.</p>
      <ul className="grid gap-2 border-t border-dashed border-[#c9c2b0] pt-3">
        {LINES.map((line) => (
          <li key={line.who} className="grid grid-cols-[auto_1fr] items-baseline gap-x-2.5 text-sm">
            <span
              aria-hidden
              className={cn("size-2 translate-y-[-1px] rounded-full", line.status === "needs" ? "bg-[#b4590b]" : "bg-[#1f7a52]")}
            />
            <span>
              <b className="font-semibold">{line.who}</b> · {line.what}
              <span className="sr-only">{line.status === "needs" ? " Needs you." : " Answered."}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
