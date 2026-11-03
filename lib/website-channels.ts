// Where ansa answers, as the public website says it (step 58): ONE list the
// home page ("Where it answers", "How it works", the questions) and the
// Pricing page read, so a channel opening up is one change here.
// "now": someone who signs up today can use it. "soon": not open to
// everyone yet. Switch one to "now" only once it works for real customers
// (docs/going-live.md, section 15): WhatsApp Business and Facebook Messenger
// once Meta has approved ansa's app, phone calls once a phone provider
// answers ansa's number.
export type WebsiteChannel = {
  name: string;
  // How a sentence names it: "phone calls".
  inSentence: string;
  status: "now" | "soon";
  note: string;
};

export const WEBSITE_CHANNELS: WebsiteChannel[] = [
  { name: "Telegram", inSentence: "Telegram", status: "now", note: "Your own account, for you or your business." },
  { name: "Email", inSentence: "email (as notes)", status: "now", note: "Forward your email to ansa: each one becomes a note in your inbox." },
  {
    name: "WhatsApp Business",
    inSentence: "WhatsApp Business",
    status: "soon",
    note: "Your WhatsApp Business number: keep the app on your phone, ansa answers when you can't.",
  },
  { name: "Facebook Messenger", inSentence: "Facebook Messenger", status: "soon", note: "Your business's Facebook Page." },
  { name: "Phone calls", inSentence: "phone calls", status: "soon", note: "Calls you don't pick up, answered and written down." },
  { name: "Instagram", inSentence: "Instagram", status: "soon", note: "Business and creator accounts." },
];

// The channels with this status as a sentence names them ("Telegram and
// email (as notes)"); "" when there are none.
export function channelsInWords(status: WebsiteChannel["status"]): string {
  return listInWords(WEBSITE_CHANNELS.filter((channel) => channel.status === status).map((channel) => channel.inSentence));
}

// Whether the website may say this channel works today.
export function channelIsOpen(name: string): boolean {
  return WEBSITE_CHANNELS.some((channel) => channel.name === name && channel.status === "now");
}

// "a", "a and b", "a, b and c".
export function listInWords(items: string[]): string {
  if (items.length <= 1) {
    return items.join("");
  }
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
