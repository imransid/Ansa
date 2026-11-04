# Show ansa on this laptop

Everything runs on this laptop, for free: no accounts to buy and no card.
The AI is Claude Code on this computer, with your own login (it needs the
internet, as Claude Code always does). The customers' apps (WhatsApp,
Telegram, Messenger), email, the Facebook Page and other social accounts,
payments and the phone are local stand-ins that behave like the real ones.
Nothing leaves this laptop except the AI's questions to Claude (and, on the
practice phone, your voice to Chrome's speech service: see step 9).

## Start

1. In the ansa folder: `pnpm demo`. It starts Docker Desktop if needed, the
   database, the brain, core and the screens, all in this one terminal.
   Wait for "ansa is running" (the first time a few minutes: it builds
   core; then about half a minute).
2. Open http://localhost:3000/login in Chrome. (The screens listen on this
   laptop only: other computers on the Wi-Fi can't open them.)
3. To stop everything: Ctrl+C in that terminal.

**Before each demo** (the same day): `pnpm demo:reset` in a second terminal,
while `pnpm demo` runs. It deletes every `@demo.ansa.test` account (also the
ones you signed up while rehearsing) and makes the demo again, with a day of
history (it takes a few seconds, and logs every window out). Chats can only
be answered within 24 hours of the customer's last message, so reset on
the demo day. Then open each page once (Home, Inbox, a conversation,
Comments, Orders, the practice chat and phone) so they are ready before the
audience is.

## The accounts

Password for all: `ansa-demo-2026`

| Log in as | Who |
| --- | --- |
| `business@demo.ansa.test` | Nadia Rahman, owner of **Shapla Kitchen**, a restaurant in Dhanmondi (menu in taka, delivery and pickup, open all day, answers on its own, "Post for me" on) |
| `karim@demo.ansa.test` | Karim Hossain, a **member** of Shapla Kitchen who handles deliveries and complaints |
| `rafa@demo.ansa.test` | **Rafa**, a freelance designer ("Just me"), who is away: ansa answers for him |

## What is already there

Shapla Kitchen's day, before you start:

- **Inbox**: about 15 conversations on WhatsApp, Telegram and Messenger.
  Questions ansa answered (opening hours, vegetarian dishes), orders, a
  complaint (Sara, sent to Karim), a wedding catering request (Nusrat, sent
  to Nadia), a booking Nadia answered herself (Habib: "taken over"), and an
  old chat from two days ago (Shirin) that can't be answered any more
  (WhatsApp's 24 hours).
- **ansa's checks**: Jamal asked for a cheaper kacchi and the AI wrote "BDT
  250": not a menu price, so ansa didn't send it. Sumi complained and the
  AI promised a refund: ansa didn't send that either. Both got the polite
  holding reply and are under **Needs you**.
- **Ask me first**: Rupa's question was answered while the restaurant was on
  "Ask me first": the reply waits for you (Send, Edit or Discard).
- **Orders**: one at every step: new (Shakil, waiting for you to accept),
  accepted, on its way, done and cancelled.
- **All requests**: requests typed in by the team (Kamal's missing borhani,
  sent to Karim, and his second call, sent to Karim too because it's the
  same customer), one solved with an email to the customer, one whose
  email bounced, and one closed without emailing.
- **Calls**: two finished phone calls (one solved by ansa, one that needs a
  person), with a recording you can play.
- **Emails**: two forwarded emails that became requests, and one whose
  content couldn't be fetched ("Process again").
- **Comments** (Inbox → Comments): three comments on a published Facebook
  post: a question ansa answered under the comment, a Bangla price question
  ("দাম কত?") answered with a short public reply and the prices in a
  private Messenger message, and praise ansa left alone.
- **Saved answers**: allergens, catering, seating and parking (each in
  English and Bangla), and the restaurant's story (for posts).
- **Social media posts**: a marketing plan, posts at every step (an idea, a
  draft, one the AI wrote with its claims, one rejected, one archived, one
  approved, one scheduled for tomorrow), six published with their numbers
  (simulated), and the marketing interview with proposals waiting.

Rafa's night: Arif asked a price (answered from Rafa's own notes), Maya
asked to move a call (ansa never decides for Rafa: a note for him), and Mum
(marked important) was passed straight to him.

## The story (about 15 minutes)

Use two Chrome windows side by side. Left: you, the owner. Right: the
customer, at Settings → Connections → **Practice chat**
(http://localhost:3000/settings/channels/practice-chat). Pick the app the
customer writes on and their name. Use new names (the ones below): a name
already in the Inbox continues that customer's chat.

**Restaurant** (log in as `business@demo.ansa.test`):

1. **Home**: what ansa is doing right now, what needs you, what ansa did
   today, the business in numbers.
2. **A question.** As **Ayesha** on WhatsApp: "Hi! Are you open tonight? Do
   you deliver to Dhanmondi?" ansa answers in a few seconds, says it is the
   restaurant's AI assistant, and uses only the restaurant's own details.
3. **An order.** Ayesha: "I'd like 2 Kacchi Biryani and 1 Borhani,
   delivered to House 12, Road 5, Dhanmondi." ansa writes the order with
   the prices and the total itself (2 × 450 + 80 + 60 delivery = BDT 1,040)
   and asks for a yes. Ayesha: "Yes". The order is placed (the next number,
   #6).
4. **Orders**: Ayesha's order and Shakil's are new. Press Accept, then On
   its way, then Done. The customer sees each step in their chat.
5. **A saved answer.** Ayesha: "Do you have parking?" ansa answers from the
   saved answer. (Saved answers → "Test what the AI finds" shows what it
   reads.)
6. **Bangla.** As **রুমি** on Telegram: "আজকে কি খোলা আছে? কাচ্চিতে কি বাদাম
   আছে?" ansa answers in Bangla (its AI label too). Then an order in Bangla ("২টা কাচ্চি
   বিরিয়ানি পিকআপ করব, সন্ধ্যা ৭টায়", then "হ্যাঁ"): ansa's summary,
   total and confirmation come in Bangla too.
7. **A complaint.** As **Tania** on Messenger: "My food was cold!" ansa
   doesn't argue or promise money: it sends your polite holding reply and
   puts it under **Needs you**, and emails you (see 14).
8. **Needs you**: open Rupa (Send the waiting reply), Jamal and Sumi (what
   ansa stopped), then Tania: answer her yourself or press Done.
   In the practice chat, tick "Answer as the business, from its own app"
   and write as Shapla Kitchen to a customer: the Inbox shows "Written in
   the WhatsApp Business app", and ansa stays quiet in that chat (as if
   you answered from your phone) until you press Hand back.
9. **A phone call.** Settings → Connections → **Practice phone** (Chrome):
   call, ask a question or order out loud (or type), hang up. The call is a
   conversation in your Inbox, with ansa's note when someone has to act
   (say "Please ask the manager to call me back about a party of 20").
   Each visit calls from a new made-up number; **New caller** is someone
   else. Chrome hears you with Google's speech service; the page also
   offers Whisper, which stays on this laptop but hears Bangla poorly.
10. **An email.** Practice chat → **Email**: write as a customer, for
    example a catering request. It becomes a request with the AI's summary
    in a few seconds (Inbox, and the Emails page).
11. **A comment on Facebook.** Practice chat → **Facebook comment**: pick
    the post and comment as **Mitu**: "Are you open on Friday night?" ansa
    answers under the comment in a few seconds, from the restaurant's own
    details. Then as **Farhana**: "দাম কত?" ansa posts a short public reply
    (the details are in Messenger) and sends her a private message with the
    menu's prices: press **Open Farhana's Messenger chat** to see it, and
    answer as her there (an order goes on as in step 3). Inbox →
    **Comments** shows every comment and what ansa did. A complaint in a
    comment gets a short sorry, a private message and a request under
    **Needs you**; praise and spam get nothing.
12. **Requests and the team.** Inbox → All requests: the views (Open, Mine,
    Unassigned, Solved), Kamal's two requests (same customer, same person),
    notes and history. Solve one with an email.
13. **Karim's view.** Log in as `karim@demo.ansa.test` in a private window:
    a member sees his requests and the Inbox, reads Settings without
    changing them, and has no Billing.
14. **The development mailbox.** Settings → Connections → Development
    mailbox: every email ansa wrote (alerts to you, "request #N is yours"
    to Karim, the solved email to the customer).
15. **Post for me.** Settings → Posts for me → **Post one now**: ansa
    writes a post from the restaurant's own details and it goes out on the
    (stand-in) Facebook Page.
16. **Billing**: the free trial (its days and end date), this month's use,
    the three packages. "Demo payments: nothing is charged": the demo
    steps show what happens when the trial ends or the AI replies are used
    up (ansa still answers every customer, with the holding reply), and
    "Simulate: back to normal" undoes them. Use them at the end of the demo, or
    reset afterwards.

**One person** (log out, log in as `rafa@demo.ansa.test`):

17. **Home**: "You're away. ansa is answering for you", and **While you
    were away**: what ansa did last night. Press Got it.
18. In the practice chat, as **Nabil** on WhatsApp: "How much do you charge
    for a logo?" ansa answers from Rafa's own notes. Then: "Can we meet
    tomorrow at 3 pm?" ansa never agrees to a meeting, money or a decision
    for Rafa: it takes a note (Needs you).
19. **I'm back** on Home: now ansa leaves messages to Rafa (or waits the
    minutes set in Settings → Assistant before stepping in: the
    conversation says when ansa answers, and "Answer now" skips the wait
    in development). **I'm away** again: ansa takes back every chat Rafa
    had taken over and answers what waits. (Rafa has no away hours, so
    this works at any time of day; Settings → Assistant can add them.)
20. **Your phone.** Settings → **Your phone** → Connect your phone: a QR
    code and the same code to type. Open the ansa app and scan it (on this
    laptop the app runs in the iPhone simulator or the Android emulator:
    "For developers" on that page says how, and a simulator can't scan, so
    type the code). The phone shows up as Reachable. Press **I'm back** on
    Home if Rafa is away (ansa never ends an "I'm away" you pressed
    yourself), and switch on **Answer for me when my phone is unreachable**
    with 1 minute. Close the app or turn on airplane mode: after the
    minute, Home says "Your phone has been unreachable since ...: ansa
    answers for you". Open the app again: ansa switches back by itself.

**The website**: http://localhost:3000 and http://localhost:3000/pricing.

## More to show

- **Marketing** (Settings → Social media posts → Marketing planner): the
  business profile and the interview's proposals (Confirm "Words to avoid":
  the draft that says "the best in Dhaka" can't be approved any more), the
  marketing plan, a new draft with the AI (claims checked), Scheduled
  posts, "Plan the next 2 weeks" on the calendar, and How posts did →
  **Review performance** (the AI reads the numbers; takes a minute).
- **Calls page** (Inbox → Calls): the two finished calls, the recording,
  "Open a request for this call" on the solved one. Calls made on the
  practice phone aren't listed there (nor counted on Home): each is a
  conversation in the Inbox, as the page says.
- **Emails page** (Inbox → Emails): "Process again" on Imtiaz's email, and
  the bounced email under "Customer emails not delivered".
- **Comments page** (Inbox → Comments): the post's three comments and what
  ansa did with each (answered under it, wrote privately in Messenger with
  a link to that chat, or left it and why). With **Ask me first** (Settings
  → Assistant), ansa's own answer to a new comment waits there for Send or
  Discard; its fixed words (the "see Messenger" reply) never wait. Settings
  → Connections → Facebook Page switches answering comments on or off.
- **Menu**: Settings → Menu and prices → "Not available today" on a dish
  (ansa stops offering it and tells customers it's not available today:
  ask about Shorshe Ilish, which the demo marks so), and **Read my menu**: a photo of a menu, a
  PDF, a Word file or pasted text, for example: `Desserts / Roshogolla (2
  pcs) 40 / Mishti Doi 70 / Drinks / Lemon Mint 90 / Cha 20` (the AI
  reads it; nothing is added until "Looks right"). Prices typed the way
  people write them work: "1,250", "৪৫০", "1,50,000".
- **Sign up live**: log out, Get started, an address like
  `nadia+1@demo.ansa.test`. The "check your email" page shows the email
  (development only): open the link, enter the password, and the welcome
  setup starts. `pnpm demo:reset` deletes it again.
- **The ansa app** (once connected on Settings → Your phone): what ansa
  is doing right now, who needs you and what ansa did, and I'm away /
  I'm back from the phone.
- **Ask me first**: Settings → Assistant → reply mode.
- **Team**: Settings → Team: categories and who handles them, invite a
  teammate (copy the link, open it in a private window, join).

## What is real, and what is a stand-in

- **Real**: the whole app, the AI's answers, ansa's checks (prices, refunds,
  links), orders and totals, requests, routing and Needs you, the team,
  packages and limits.
- **Stand-ins**: the customers' apps (the practice chat), email (files in
  `.dev-emails/`, shown in the development mailbox), the Facebook Page and
  other social accounts (posts are files in `.dev-social/`; comments on the
  Page's posts come from the practice chat), images (the
  development stand-in draws them), post numbers (simulated, and marked so),
  payments (the Simulate buttons) and phone calls (the practice phone).
- **The website** says WhatsApp, Messenger and phone calls are "Coming
  soon": they are built and work here, and open to customers after Meta's
  approval and a phone provider.
- **For real customers** each channel needs its own account: Meta's
  approval for WhatsApp, Messenger, Facebook posts and answering their
  comments (two more permissions), a phone provider
  for calls, and ansa's Telegram bot (free to make). Whether Telegram still
  needs Premium for a business chatbot is unclear (sources disagree). If
  your own Telegram can add a chatbot (Settings → Telegram Business →
  Chatbots), a real Telegram demo also works on this laptop, without a
  public address: docs/going-live.md, section 12, step 5. Disconnect the
  demo's stand-in Telegram first (one Telegram account per company), run
  `make telegram-poll` (in core/) in a third terminal, and connect again
  after every reset (it makes a new company).

## If something goes wrong

- **"something already runs on port 3000 / 8080 / 8090"**: another copy of
  ansa is running. Stop it (Ctrl+C in its terminal), then `pnpm demo`.
- **No answer from ansa**: answers take 5 to 15 seconds. Check that Claude
  Code is logged in (run `claude` once in a terminal); `pnpm demo` says at
  start when it can't find the claude program.
- **ansa sent the holding reply**: it passed that message to you (Needs
  you). Open the conversation, answer or press Done, and ansa carries on.
  Until then ansa stays quiet in that chat: use a new customer name.
- **ansa says nothing at all to one customer**: ansa answers one customer at
  most 20 times an hour (and stays quiet while that chat has an open
  request). Use a new customer name, or reset.
- **A limit was reached** (rehearsing many times in an hour): `pnpm
  demo:reset` starts both accounts clean, counters included.
- **After the demo**: Ctrl+C stops ansa; `pnpm db:down` also stops the
  database (its data is kept).
- **Anything else**: `pnpm demo:reset`.
