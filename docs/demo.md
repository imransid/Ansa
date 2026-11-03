# Show ansa on this laptop

Everything runs on this laptop, for free: no accounts to buy and no card.
The AI is Claude Code on this computer, with your own login (it needs the
internet, as Claude Code always does). The customers' apps (WhatsApp,
Telegram, Messenger), the Facebook Page, email and payments are local
stand-ins that behave like the real ones.

## Start

1. In the ansa folder: `pnpm demo`. It starts Docker Desktop if needed, the
   database, the brain, core and the screens, all in this one terminal.
   Wait for "ansa is running" (the first time about a minute).
2. Open http://localhost:3000/login in Chrome.
3. To stop everything: Ctrl+C in that terminal.

Before each demo, start clean: `pnpm demo:reset` (in a second terminal,
while `pnpm demo` runs). It deletes the two demo accounts and makes them
again.

## The two demo accounts

Password for both: `ansa-demo-2026`

| Log in as | Who | Set up as |
| --- | --- | --- |
| `business@demo.ansa.test` | Shapla Kitchen, a restaurant in Dhaka | Menu with prices in taka, delivery and pickup, answers on its own, "Post for me" on |
| `rafa@demo.ansa.test` | Rafa, a freelance designer | "Just me", and "I'm away" is on |

## The story (about 10 minutes)

Use two Chrome windows side by side. Left: you, the owner (Home, Inbox,
Orders). Right: the customer, at Settings → Connections → **Practice chat**
(http://localhost:3000/settings/channels/practice-chat). Pick the app the
customer writes on (WhatsApp, Telegram or Messenger) and their name.

**Restaurant** (log in as `business@demo.ansa.test`):

1. **Home**: what ansa is doing right now, what needs you, what ansa did.
2. **A question.** The customer writes: "Hi! Are you open tonight? Do you
   deliver to Dhanmondi?" ansa answers in a few seconds, says it is the
   restaurant's AI assistant, and uses only the restaurant's own details.
3. **An order.** "I'd like 2 Kacchi Biryani and 1 Borhani, delivered to
   House 12, Road 5, Dhanmondi." ansa writes the order with the prices and
   the total itself (2 × 450 + 80 + 60 delivery = BDT 1,040) and asks for a
   yes. The customer writes "Yes": order #1 is placed.
4. **Orders** (left): order #1 is there. Press Accept, then On its way,
   then Done. The customer sees each step in their chat.
5. **Bangla.** The customer writes in Bangla, for example "আজকে কি খোলা
   আছে?". ansa answers in Bangla.
6. **A complaint.** With another customer's name (for example "Sara"):
   "My food was cold!" ansa doesn't argue or promise money: it sends your
   polite holding reply and puts it under **Needs you** for you. (After
   that ansa waits for you in that chat: that's why it's another name.)
7. **A phone call.** Settings → Connections → **Practice phone**
   (Chrome): call, ask a question or order out loud (or type), hang up. The
   call is in your Inbox with ansa's note. Chrome hears you with Google's
   speech service; the page also offers Whisper, which stays on this
   laptop but hears Bangla poorly.
8. **Post for me.** Settings → Posts for me → **Post one now**. ansa
   writes a post from the restaurant's own details, and it goes out on the
   (stand-in) Facebook Page: the list shows it as posted.
9. **Packages.** Settings → Billing: the free trial, this month's use, and
   the three packages ("Simulate: choose" shows a change of package).

**One person** (log out, log in as `rafa@demo.ansa.test`):

10. **Home** says "You're away: ansa is answering for you."
11. In the practice chat: "How much do you charge for a logo?" ansa
    answers from Rafa's own notes. Then: "Can we meet tomorrow at 3 pm?"
    ansa never agrees to a meeting, money or a decision for Rafa: it takes
    a note. Back on **Home**: "While you were away" and **Needs you**.

**The website**: http://localhost:3000 and http://localhost:3000/pricing.

## What is real, and what is a stand-in

- **Real**: the whole app, the AI's answers, ansa's checks (prices, refunds,
  links), orders and totals, requests and Needs you, packages and limits.
- **Stand-ins**: the customers' apps (the practice chat), the Facebook Page
  (posts are files in `.dev-social/`), emails (files in `.dev-emails/`),
  payments (the Simulate buttons) and phone calls (the practice phone, in
  Chrome).
- **For real customers** each channel needs its own account: Meta's
  approval for WhatsApp, Messenger and Facebook posts, a phone provider
  for calls, and ansa's Telegram bot (free to make). Whether Telegram still
  needs Premium for a business chatbot is unclear (sources disagree). If
  your own Telegram can add a chatbot (Settings → Telegram Business →
  Chatbots), a real Telegram demo also works on this laptop, without a
  public address: docs/going-live.md, section 12, step 5 (`make
  telegram-poll`).

## If something goes wrong

- **"something already runs on port 3000 / 8080 / 8090"**: another copy of
  ansa is running. Stop it (Ctrl+C in its terminal), then `pnpm demo`.
- **No answer from ansa**: answers take 5 to 15 seconds. Check Settings →
  Assistant: the AI engine is "Claude Code on this computer", and that
  Claude Code is logged in (run `claude` once in a terminal).
- **ansa sent the holding reply**: it passed that message to you (Needs
  you). Open the conversation, answer or press Done, and ansa carries on.
- **Anything else**: `pnpm demo:reset` starts both accounts clean.
