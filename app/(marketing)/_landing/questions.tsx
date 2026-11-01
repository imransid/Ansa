// A few honest answers to what people ask before they hand their messages
// to an assistant (rewritten 2026-11-01 for a person or a business), each
// opening on its own (no script needed). The price isn't decided yet
// (step 56), so the answer says only what is true today.
//
// LAUNCH CHECK (step 57): the channels (steps 53 and 55) and the price
// (step 56) must be settled first.
const QUESTIONS = [
  {
    question: "Will people think they're talking to me?",
    answer: "No. Its first message says it is your AI assistant, every time. It speaks for you, never as you.",
  },
  {
    question: "What if it gets something wrong?",
    answer:
      "It answers only from what you gave it: your details, prices and notes. When it isn’t sure, it doesn’t guess: it tells them you’ll get back to them, and tells you. You can read every message it sent.",
  },
  {
    question: "Can it agree to a meeting or a price for me?",
    answer: "No. Meetings, money, promises and decisions always come to you as a note. ansa only says you’ll confirm.",
  },
  {
    question: "Does it answer when I'm around?",
    answer:
      "Only if you want it to. Choose always, your away hours (like nights), “I’m away” on Home, or only when you haven’t answered within a few minutes.",
  },
  {
    question: "Which channels does it answer?",
    answer:
      "Telegram today, and email as notes. Calls, Facebook Messenger, WhatsApp Business and Instagram are next. A personal WhatsApp number or Facebook profile can’t be connected: WhatsApp and Meta don’t allow it.",
  },
  { question: "Is it only for businesses?", answer: "No. Choose “Just me” when you sign up, and it works as your personal assistant." },
  { question: "What does it cost?", answer: "You see the price before you pay anything, and you can cancel at any time." },
];

export function Questions() {
  return (
    <section className="bg-sheet">
      <div className="mx-auto grid w-full max-w-3xl gap-8 px-6 py-24">
        <h2 className="font-display text-4xl leading-tight font-[340] tracking-[-0.03em]">Questions people ask.</h2>
        <div className="divide-y border-y">
          {QUESTIONS.map((item) => (
            <details key={item.question} className="group py-1">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-sm py-4 text-lg font-semibold [&::-webkit-details-marker]:hidden">
                {item.question}
                <span aria-hidden className="font-display text-2xl text-link transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="max-w-[60ch] pb-5 text-muted-foreground">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
