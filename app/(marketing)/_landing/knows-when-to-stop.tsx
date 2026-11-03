// "It knows when to call you" (forest; rewritten 2026-11-01 for a person or
// a business): what ansa will not do on its own, which is what anyone fears
// most about an AI talking to the people in their life or their customers.
// Every promise here is what ansa does in chats today (steps 49 to 52).
const PROMISES = [
  { title: "It says it’s an AI.", text: "Its first message says it is your AI assistant. It never pretends to be you." },
  { title: "It never speaks out of turn.", text: "No meetings, money, promises or decisions for you. Those become notes." },
  { title: "Important people always reach you.", text: "Mark anyone important, and ansa hands them to you at once, every time." },
  { title: "You choose when it answers.", text: "Always, at your away hours, when you press “I’m away”, or only if you haven’t answered in time." },
  { title: "It never guesses a price.", text: "Prices come only from what you gave it, and ansa works out every total itself." },
  { title: "Nothing is hidden from you.", text: "Every message it sent is in your inbox, and you can pause it whenever you like." },
];

export function KnowsWhenToStop() {
  return (
    <section className="bg-(image:--briefing) text-ivory">
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 py-24">
        <div className="grid max-w-2xl gap-4">
          <h2 className="font-display text-4xl leading-tight font-[340] tracking-[-0.03em] sm:text-5xl">It knows when to call you.</h2>
          <p className="text-ivory/80">A good assistant answers what it can and fetches you only when it matters. So does ansa.</p>
        </div>
        <ul className="grid gap-x-12 sm:grid-cols-2 lg:grid-cols-3">
          {PROMISES.map((promise) => (
            <li key={promise.title} className="grid content-start gap-1.5 border-t border-brass/30 py-6">
              <h3 className="font-display text-2xl font-[360]">{promise.title}</h3>
              <p className="max-w-[44ch] text-ivory/80">{promise.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
