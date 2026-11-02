// The restaurant setup (step 45): the kinds of food business, the steps a new
// owner goes through at /welcome, and the limits of what they type. Pure, so
// the pages share one list; core keeps its own copy (core/internal/setup).

// Who ansa represents (step 50, the owner's direction of 2026-11-01): a
// business and its customers, or one person ("personal": ansa is their
// shadow, answering for them while they are away). Chosen at setup's first step.
export const COMPANY_KINDS = ["business", "personal"] as const;
export type CompanyKind = (typeof COMPANY_KINDS)[number];

export const COMPANY_KIND_LABELS: Record<CompanyKind, string> = {
  business: "My business",
  personal: "Just me",
};

// Every kind of business (widened in step 54: ansa is for any business;
// food first, as the first customers are restaurants).
export const BUSINESS_TYPES = [
  "restaurant",
  "cafe",
  "bakery",
  "takeaway",
  "food_truck",
  "bar",
  "catering",
  "shop",
  "beauty",
  "health",
  "fitness",
  "services",
  "property",
  "other",
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  restaurant: "Restaurant",
  cafe: "Café",
  bakery: "Bakery",
  takeaway: "Takeaway",
  food_truck: "Food truck",
  bar: "Bar",
  catering: "Catering",
  shop: "Shop or online store",
  beauty: "Salon, barber or beauty",
  health: "Clinic or health practice",
  fitness: "Gym or fitness studio",
  services: "Services, freelance or agency",
  property: "Estate agent",
  other: "Something else",
};

// The name a new owner's company has between signing up and the first setup
// step, where they type the real one. Signup asks only for a name, an email
// and a password (2026-10-31 plan).
export const NEW_COMPANY_NAME = "New business";

// The setup steps in order, for a business. Each but "ready" is saved by
// its own form; setup_progress (companies) counts how many were saved, so a
// returning owner lands on the first one left. "ready" finishes setup.
export const SETUP_STEPS = [
  { key: "business", title: "Who ansa is for" },
  { key: "contact", title: "Where to find you" },
  { key: "hours", title: "Opening hours" },
  { key: "orders", title: "Orders and payment" },
  { key: "assistant", title: "How ansa answers" },
  { key: "connect", title: "Your channels" },
  { key: "ready", title: "Your assistant is ready" },
] as const;

// For one person (step 50): who they are, when ansa answers for them, what
// it says, and their channels. No address, opening hours or orders.
export const PERSONAL_SETUP_STEPS = [
  { key: "business", title: "Who ansa is for" },
  { key: "away", title: "When ansa answers for you" },
  { key: "assistant", title: "How ansa answers" },
  { key: "connect", title: "Your channels" },
  { key: "ready", title: "Your assistant is ready" },
] as const;

export type SetupStepKey = (typeof SETUP_STEPS)[number]["key"] | (typeof PERSONAL_SETUP_STEPS)[number]["key"];

export function setupStepsFor(kind: CompanyKind): readonly { key: SetupStepKey; title: string }[] {
  return kind === "personal" ? PERSONAL_SETUP_STEPS : SETUP_STEPS;
}

// How many steps save something (all but "ready"): setup_progress runs 0 to this.
export const SAVED_SETUP_STEPS = SETUP_STEPS.length - 1;

export function savedSetupSteps(kind: CompanyKind): number {
  return setupStepsFor(kind).length - 1;
}

// The step an owner with this progress should see: the first one not saved yet.
export function nextSetupStep(progress: number, kind: CompanyKind = "business"): SetupStepKey {
  const steps = setupStepsFor(kind);
  const index = Math.min(Math.max(progress, 0), steps.length - 1);
  return steps[index].key;
}

// The step a page asked for, or the next one due when it asked for a step
// further on, or one this kind doesn't have (steps are done in order; going
// back is always allowed).
export function stepToShow(asked: string | undefined, progress: number, kind: CompanyKind = "business"): SetupStepKey {
  const steps = setupStepsFor(kind);
  const due = nextSetupStep(progress, kind);
  const askedIndex = steps.findIndex((step) => step.key === asked);
  if (askedIndex === -1 || askedIndex > steps.findIndex((step) => step.key === due)) {
    return due;
  }
  return steps[askedIndex].key;
}

// 1-based position of a step, for "Step 3 of 7".
export function setupStepNumber(step: SetupStepKey, kind: CompanyKind = "business"): number {
  return setupStepsFor(kind).findIndex((candidate) => candidate.key === step) + 1;
}

// What ansa says to a customer when it can't answer, or the message is a
// complaint or a refund (2026-10-31 decision): short, fixed and polite, so
// nobody waits in silence. Owners can change it; it is sent from step 49 on.
export const DEFAULT_HOLDING_REPLY = "Thank you for your message. Our team will get back to you as soon as possible.";

// A person's (step 50): their name, as ansa says it, never a pronoun.
export function personalHoldingReply(name: string): string {
  return `Thanks for your message. ${name} can't reply right now. I've passed it on, and ${name} will get back to you soon.`;
}

// The limits of the setup and settings forms, shared with their Zod schemas.
export const DESCRIPTION_MAX_LENGTH = 300;
export const ADDRESS_MAX_LENGTH = 300;
export const PUBLIC_PHONE_MAX_LENGTH = 40;
export const NOTE_MAX_LENGTH = 500;
export const INSTRUCTIONS_MAX_LENGTH = 2000;
export const HOLDING_REPLY_MAX_LENGTH = 500;

// Whether the assistant is answering, and how (step 49 acts on these).
export const ASSISTANT_STATUSES = ["on", "paused"] as const;
export type AssistantStatus = (typeof ASSISTANT_STATUSES)[number];

// Automatic is the default: ansa's main job is answering when the owner
// can't (2026-10-31 decision). "ask_first" makes each reply wait for the owner.
export const REPLY_MODES = ["automatic", "ask_first"] as const;
export type ReplyMode = (typeof REPLY_MODES)[number];

// How the sidebar and Settings say the mode in a few words.
export function describeReplyMode(status: AssistantStatus, mode: ReplyMode): string {
  if (status === "paused") {
    return "Paused";
  }
  return mode === "automatic" ? "Answers on its own" : "Asks you first";
}
