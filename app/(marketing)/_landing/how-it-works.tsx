import { channelsInWords } from "@/lib/website-channels";

// "How it works": three steps on paper, numbered in the display serif, under
// a brass rule (rewritten 2026-11-01 for a person or a business). Step 2
// names the channels from the website's one list (lib/website-channels.ts).
const soonChannels = channelsInWords("soon");

const STEPS = [
  {
    title: "Tell ansa who you are",
    text: "Your details, your prices or menu, and what it may say for you. About five minutes, and a photo of a menu is enough.",
  },
  {
    title: "Connect where people reach you",
    text: `${capitalized(channelsInWords("now"))} today, with the accounts people already write to.${soonChannels ? ` ${capitalized(soonChannels)} soon.` : ""}`,
  },
  {
    title: "It answers when you can't",
    text: "On its own or asking you first, always or only while you're away. Anything it isn't sure of comes straight to you.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-6 bg-background">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-24">
        <h2 className="max-w-[18ch] font-display text-4xl leading-tight font-[340] tracking-[-0.03em] sm:text-5xl">Ready in five minutes.</h2>
        <ol className="grid gap-10 border-t border-brass pt-8 sm:grid-cols-3 sm:gap-8">
          {STEPS.map((step, index) => (
            <li key={step.title} className="grid content-start gap-2">
              <span className="font-display text-3xl text-[#8a6a2e] dark:text-brass">{index + 1}</span>
              <h3 className="text-lg font-semibold">{step.title}</h3>
              <p className="max-w-[36ch] text-muted-foreground">{step.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function capitalized(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}
