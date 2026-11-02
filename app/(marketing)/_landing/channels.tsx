import { StatusDot } from "@/components/status-dot";

// "Where it answers" (2026-11-01): every channel with where it really stands,
// so nobody signs up for one that isn't there yet, and the two that can never
// be connected, said plainly (trust is the product).
//
// LAUNCH CHECK (step 58): update each status as steps 53 and 55 land.
const CHANNELS: { name: string; status: "now" | "next"; note: string }[] = [
  { name: "Telegram", status: "now", note: "Your own account, for you or your business." },
  { name: "Email", status: "now", note: "Forward it to ansa: every email becomes a note in your inbox. Replies come next." },
  { name: "Phone calls", status: "next", note: "Calls you don't pick up, answered and written down." },
  { name: "Facebook Messenger", status: "next", note: "Your business's Facebook Page." },
  { name: "WhatsApp Business", status: "next", note: "A WhatsApp Business number, for businesses." },
  { name: "Instagram", status: "next", note: "Business and creator accounts." },
];

export function Channels() {
  return (
    <section className="bg-background">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-24 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
        <div className="grid content-start gap-4">
          <h2 className="font-display text-4xl leading-tight font-[340] tracking-[-0.03em] sm:text-5xl">Where it answers.</h2>
          <p className="max-w-[38ch] text-muted-foreground">
            One inbox for every place people reach you. A personal WhatsApp number or Facebook profile can&rsquo;t be connected to any
            assistant: WhatsApp and Meta don&rsquo;t allow it.
          </p>
        </div>
        <ul className="divide-y border-y">
          {CHANNELS.map((channel) => (
            <li key={channel.name} className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr_auto] sm:items-baseline sm:gap-6">
              <span className="font-semibold">{channel.name}</span>
              <span className="text-muted-foreground">{channel.note}</span>
              <StatusDot tone={channel.status === "now" ? "success" : "quiet"} className="sm:justify-self-end">
                {channel.status === "now" ? "Available" : "Coming soon"}
              </StatusDot>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
