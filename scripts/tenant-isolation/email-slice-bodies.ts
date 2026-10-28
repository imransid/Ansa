// Email bodies for email-slice-checks.ts (step 28, finding brain/12), each as
// a mail program really writes it. "OLD-THREAD" marks text of an earlier or
// forwarded message that must never reach Claude when the customer wrote
// something above it.

export const OUTLOOK_REPLY = [
  "Hi, the replacement still hasn't arrived. Can you check?",
  "",
  "Thanks,",
  "Pat",
  "",
  "________________________________",
  "From: Jane Doe <jane.doe@shop.test>",
  "Sent: Monday, October 19, 2026 10:00 AM",
  "To: Pat Lee <pat@customer.test>; Bob Roe <bob.roe@other.test>",
  "Subject: RE: Replacement",
  "",
  "Hello Pat, we sent a replacement. OLD-THREAD",
].join("\r\n");

// Each: the email body, and exactly what Claude must read of it.
export const THREAD_CASES: { name: string; body: string; expected: string }[] = [
  {
    name: "an Outlook reply (From / Sent / To header)",
    body: OUTLOOK_REPLY,
    expected: "Hi, the replacement still hasn't arrived. Can you check?\n\nThanks,\nPat",
  },
  {
    name: "a Gmail reply whose 'On ... wrote:' line is wrapped over two lines",
    body: ["The tracking link is broken.", "", "On Mon, Oct 19, 2026 at 10:00 AM Jane Doe from the Shop <", "jane.doe@shop.test> wrote:", "", "> Your order has shipped.", "> OLD-THREAD"].join("\n"),
    expected: "The tracking link is broken.",
  },
  {
    name: "a reply made from HTML (the earlier message is not quoted with '>')",
    body: "Please cancel my order.\n\nOn Mon, Oct 19, 2026 at 10:00 AM Jane Doe <jane.doe@shop.test> wrote:\n\nYour order has shipped. OLD-THREAD",
    expected: "Please cancel my order.",
  },
  {
    name: "answers written between quoted lines",
    body: "On Mon, Oct 19, 2026, Jane Doe <jane.doe@shop.test> wrote:\n> Which colour did you order? OLD-THREAD\nBlue, the large one.\n> And the size? OLD-THREAD\nSize 42.",
    expected: "Blue, the large one.\nSize 42.",
  },
  {
    name: "a forwarded message below the customer's words",
    body: "See below, I never got this refund.\n\n---------- Forwarded message ---------\nFrom: Shop <noreply@shop.test>\nDate: Mon, Oct 19, 2026\nSubject: Your refund\n\nYour refund was sent. OLD-THREAD",
    expected: "See below, I never got this refund.",
  },
  {
    name: "an old Outlook '-----Original Message-----' line",
    body: "Please check my invoice.\n\n-----Original Message-----\nFrom: Jane Doe\nSent: Monday\n\nOLD-THREAD",
    expected: "Please check my invoice.",
  },
  {
    name: "Apple Mail's 'Begin forwarded message:'",
    body: "FYI, wrong item.\n\nBegin forwarded message:\n\nFrom: Shop <noreply@shop.test>\nSubject: Shipped\n\nOLD-THREAD",
    expected: "FYI, wrong item.",
  },
  {
    name: "a German Gmail reply",
    body: "Bitte stornieren.\n\nAm Mo., 19. Okt. 2026 um 10:00 Uhr schrieb Jane Doe <jane.doe@shop.test>:\n> OLD-THREAD",
    expected: "Bitte stornieren.",
  },
  {
    name: "a French Gmail reply",
    body: "Merci d'annuler.\n\nLe lun. 19 oct. 2026 à 10:00, Jane Doe <jane.doe@shop.test> a écrit :\n> OLD-THREAD",
    expected: "Merci d'annuler.",
  },
  {
    name: "a German Outlook reply",
    body: "Bitte prüfen.\n\nVon: Jane Doe <jane.doe@shop.test>\nGesendet: Montag, 19. Oktober 2026 10:00\nAn: Pat\nBetreff: AW: Bestellung\n\nOLD-THREAD",
    expected: "Bitte prüfen.",
  },
  {
    name: "a signature after '-- '",
    body: "My invoice shows the wrong address.\n\n-- \nPat Lee\nHead of Purchasing, Example Ltd\n+1 555 0100",
    expected: "My invoice shows the wrong address.",
  },
];

// Nothing above the forwarded message: it IS the request, so it is kept
// (with its addresses redacted).
export const BARE_FORWARD = "---------- Forwarded message ---------\nFrom: Shop <noreply@shop.test>\nDate: Mon, Oct 19, 2026\nSubject: Your refund\n\nYour refund of 50 euros was sent.";

// A contact form that starts like an Outlook header: kept whole.
export const CONTACT_FORM = "From: Pat Lee\nDate: 19 October 2026\nOrder: 48213\nMessage: My parcel never arrived.";

// The customer's own words that only look a bit like a thread marker. Each
// must reach Claude whole: its summary and category (routing) come from it.
export const OWN_TEXT_CASES: { name: string; body: string }[] = [
  {
    name: "booking details with From:, To: and Date: lines",
    body: "Hello,\nI need to change my booking:\nFrom: London\nTo: Paris\nDate: 20 October\nPlease move it to the 22nd, my flight was cancelled.",
  },
  {
    name: "shipping details with From: and Sent: lines",
    body: "My parcel is lost.\nFrom: Berlin warehouse\nSent: 12 October by DHL\nTracking 48213 shows nothing since. Please refund me.",
  },
  {
    name: "a lone '--' line between two points",
    body: "Order 1: arrived broken\n--\nOrder 2: never arrived, please refund both.",
  },
  {
    name: "a contact form relay with a line above its From: and Date: lines",
    body: "New submission from your Contact form\n\nFrom: Pat Lee\nDate: October 19, 2026\nOrder: 48213\nMessage: My parcel never arrived.",
  },
  {
    name: "a train booking with From:, Date: and To: lines",
    body: "Hello, I want to change my train booking please.\n\nFrom: London\nDate: 12 October\nTo: Paris\n\nCan you move it to the 14th?",
  },
  {
    name: "'On Monday I wrote to you about this:'",
    body: "My order 48213 has not arrived.\nOn Monday I wrote to you about this:\n- tracking says delivered\n- nobody was home\nPlease refund me.",
  },
  {
    name: "the same in French",
    body: "Ma commande 48213 n'est pas arrivée.\nLe 12 octobre, je vous ai écrit :\n- le suivi dit livré\nMerci de me rembourser.",
  },
  {
    name: "the same in Italian",
    body: "Ordine 48213: il pacco non è arrivato.\nIl 12 ottobre vi ho scritto:\n- il tracking dice consegnato\nVi prego di rimborsarmi.",
  },
  {
    name: "the same in Dutch",
    body: "Mijn bestelling 48213 is niet aangekomen.\nOp maandag schreef ik:\n- tracking zegt bezorgd\nGraag terugbetalen.",
  },
  {
    name: "the customer's own headings between dashes",
    body: "Two problems:\n----- Problem one -----\nThe app crashes.\n----- Problem two -----\nI was charged twice.",
  },
];
