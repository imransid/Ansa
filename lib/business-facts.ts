// The topics of a company's business profile (step 36): what the AI
// Co-Founder needs to know about the business before it can help with
// marketing. A file of its own with no imports, so the forms in the browser
// and the database schema (db/schema/business-facts.ts, whose CHECK lists
// the same keys; a check proves they agree) read one list.
//
// The list's order is the interview's order: the fixed question asked when
// the AI can't read an answer is the one of the first key topic still
// missing. Key facts are the ones marketing can't do without; "none" is a
// fine answer to most of them ("we only sell services", "no paid budget").

export const businessFactTopics = [
  "company_name",
  "description",
  "industry",
  "products",
  "services",
  "target_customers",
  "customer_problems",
  "value_proposition",
  "location",
  "languages",
  "goals",
  "brand_voice",
  "marketing_channels",
  "publishing_frequency",
  "competitors",
  "campaign_budget",
  "website",
  "prices",
  "offers_promotions",
  "policies",
  "positioning",
  "social_accounts",
  "content_preferences",
  "visual_identity",
  "words_to_avoid",
] as const;
export type BusinessFactTopic = (typeof businessFactTopics)[number];

// The Profile page shows the topics in these groups, in this order.
export const businessFactGroups = ["company", "offer", "customers", "market", "brand", "marketing"] as const;
export type BusinessFactGroup = (typeof businessFactGroups)[number];

export const BUSINESS_FACT_GROUP_LABELS: Record<BusinessFactGroup, string> = {
  company: "The business",
  offer: "What you sell",
  customers: "Customers",
  market: "Market",
  brand: "Brand",
  marketing: "Marketing",
};

export type BusinessFactTopicInfo = {
  label: string;
  group: BusinessFactGroup;
  // A key fact: the profile counts as complete once every one is confirmed.
  isKey: boolean;
  // What the interview asks without the AI: one plain question.
  question: string;
};

export const BUSINESS_FACT_TOPICS: Record<BusinessFactTopic, BusinessFactTopicInfo> = {
  company_name: { label: "Business name", group: "company", isKey: true, question: "What name do your customers know the business by?" },
  description: { label: "What the business does", group: "company", isKey: true, question: "In a sentence or two, what does your business do?" },
  industry: { label: "Industry", group: "company", isKey: true, question: "Which industry or field would you say the business is in?" },
  products: { label: "Products", group: "offer", isKey: true, question: "Which products do you sell? If you only offer services, just say so." },
  services: { label: "Services", group: "offer", isKey: true, question: "Which services do you offer? If you only sell products, just say so." },
  target_customers: { label: "Target customers", group: "customers", isKey: true, question: "Who are your typical customers?" },
  customer_problems: {
    label: "Customer problems",
    group: "customers",
    isKey: true,
    question: "What problems do customers come to you to solve?",
  },
  value_proposition: {
    label: "Why customers choose you",
    group: "customers",
    isKey: true,
    question: "Why do customers choose you over the alternatives?",
  },
  location: { label: "Location", group: "company", isKey: true, question: "Where is the business based, and where do you serve customers?" },
  languages: { label: "Languages", group: "brand", isKey: true, question: "Which languages do you speak with your customers?" },
  goals: {
    label: "Marketing goals",
    group: "marketing",
    isKey: true,
    question: "What should marketing achieve for the business in the next few months?",
  },
  brand_voice: {
    label: "Brand voice",
    group: "brand",
    isKey: true,
    question: "How should the business sound when it talks to customers: for example friendly, expert or playful?",
  },
  marketing_channels: {
    label: "Marketing channels",
    group: "marketing",
    isKey: true,
    question: "Where do you market the business today, or want to: for example Instagram, LinkedIn, email or local press?",
  },
  publishing_frequency: {
    label: "Publishing frequency",
    group: "marketing",
    isKey: true,
    question: "How often could you realistically publish something new?",
  },
  competitors: {
    label: "Competitors",
    group: "market",
    isKey: true,
    question: "Who are your main competitors? If you don't know of any, just say so.",
  },
  campaign_budget: {
    label: "Campaign budget",
    group: "marketing",
    isKey: true,
    question: "Do you have a budget for paid campaigns, and if so roughly how much a month?",
  },
  website: { label: "Website", group: "company", isKey: false, question: "What is the address of your website, if you have one?" },
  prices: { label: "Prices", group: "offer", isKey: false, question: "What do your main products or services cost?" },
  offers_promotions: {
    label: "Offers and promotions",
    group: "offer",
    isKey: false,
    question: "Are there any offers or promotions running or planned?",
  },
  policies: {
    label: "Policies",
    group: "offer",
    isKey: false,
    question: "Which policies should customers know about: for example returns, delivery or cancellations?",
  },
  positioning: {
    label: "Positioning",
    group: "market",
    isKey: false,
    question: "How do you want people to see the business compared with others in your field?",
  },
  social_accounts: {
    label: "Social media accounts",
    group: "marketing",
    isKey: false,
    question: "Which social media accounts does the business have?",
  },
  content_preferences: {
    label: "Content preferences",
    group: "marketing",
    isKey: false,
    question: "What kind of posts would you like to publish: for example tips, behind the scenes or customer stories?",
  },
  visual_identity: {
    label: "Visual identity",
    group: "brand",
    isKey: false,
    question: "How would you describe the look of the business: colors, logo and style?",
  },
  words_to_avoid: {
    label: "Words to avoid",
    group: "brand",
    isKey: false,
    question: "Are there words, topics or claims the business should never use?",
  },
};

// Where a fact's confirmed value came from: the owner confirmed an
// interview or knowledge proposal as it was, or typed it themselves
// ("owner", also when they changed a proposal before confirming it).
export const factConfirmationSources = ["interview", "owner", "knowledge"] as const;
export type FactConfirmationSource = (typeof factConfirmationSources)[number];

// Where a proposal waiting for the owner came from.
export const factProposalSources = ["interview", "knowledge"] as const;
export type FactProposalSource = (typeof factProposalSources)[number];

export const FACT_SOURCE_LABELS: Record<FactConfirmationSource, string> = {
  interview: "from the interview",
  owner: "typed by an owner",
  knowledge: "from a knowledge article",
};

// The key topics, in the interview's order.
export const KEY_FACT_TOPICS: BusinessFactTopic[] = businessFactTopics.filter((topic) => BUSINESS_FACT_TOPICS[topic].isKey);

// True for a string that is one of the topic keys.
export function isBusinessFactTopic(value: unknown): value is BusinessFactTopic {
  return typeof value === "string" && (businessFactTopics as readonly string[]).includes(value);
}

// A topic's label ("Target customers"). A key the code no longer lists, read
// back from something stored earlier (a marketing plan), shows as itself.
export function labelOfTopic(topic: string): string {
  return isBusinessFactTopic(topic) ? BUSINESS_FACT_TOPICS[topic].label : topic;
}
