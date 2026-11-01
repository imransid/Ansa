import { Briefcase, HeartPulse, Home, Megaphone, Scissors, ShoppingBag, Sparkles, UtensilsCrossed } from "lucide-react";

// "Who it's for" (2026-11-01): the kinds of people and businesses whose
// messages pile up while they work, each with one thing ansa does for them.
// Every line is something ansa does from what the owner gives it (details,
// prices, notes, articles) or a note it takes; nothing here is a client or
// a result (there are none to show yet).
const WHO = [
  { icon: Briefcase, title: "Freelancers & consultants", line: "New leads get a reply at midnight. Every booking still waits for you." },
  { icon: Home, title: "Estate agents", line: "Questions about a listing you described, answered. Every viewing request, passed to you." },
  { icon: HeartPulse, title: "Clinics & practices", line: "Hours, address and how to book, answered at once. Everything else waits for you." },
  { icon: Scissors, title: "Salons & studios", line: "Prices and opening hours answered while your hands are busy." },
  { icon: ShoppingBag, title: "Shops & online stores", line: "Prices, delivery and opening hours, answered from what you wrote." },
  { icon: UtensilsCrossed, title: "Restaurants & cafés", line: "Menu questions and orders, with totals worked out by ansa." },
  { icon: Megaphone, title: "Creators & agencies", line: "First replies to new clients and partners, any hour of the day." },
  { icon: Sparkles, title: "Anyone who's busy", line: "People hear back at once, and you see who wanted what." },
];

export function WhoItsFor() {
  return (
    <section className="bg-sheet">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-24">
        <div className="grid max-w-2xl gap-3">
          <p className="text-sm text-subtle-foreground">Who it&rsquo;s for</p>
          <h2 className="font-display text-4xl leading-tight font-[340] tracking-[-0.03em] sm:text-5xl">If people wait for your answer, ansa is for you.</h2>
        </div>
        <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          {WHO.map((who) => (
            <li key={who.title} className="grid content-start gap-2 border-t py-5">
              <who.icon aria-hidden className="size-5 text-link" strokeWidth={1.6} />
              <h3 className="font-semibold">{who.title}</h3>
              <p className="text-sm text-muted-foreground">{who.line}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
