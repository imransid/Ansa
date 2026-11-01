import "server-only";
import { getAssistantSettings } from "@/db/assistant-settings";
import { getBusinessFactsForCompany } from "@/db/business-facts";
import { getActiveCategories } from "@/db/categories";
import { listConversationEntries } from "@/db/conversations";
import { searchKnowledge } from "@/db/knowledge-search";
import { listMenuItems } from "@/db/menu";
import { ordersOfConversation } from "@/db/orders";
import { getCompanySetup } from "@/db/restaurant-setup";
import type { AssistantContext } from "@/lib/assistant/prompt";
import { CONVERSATION_MESSAGES_FOR_AI } from "@/lib/assistant/prompt";
import type { ReplyCheckData } from "@/lib/assistant/reply-checks";
import { decryptForDisplay } from "@/lib/encryption";
import { conversationMessageContext } from "@/lib/encryption-contexts";
import { buildKnowledgeSlice } from "@/lib/knowledge/prompt-slice";
import { formatPrice } from "@/lib/menu";
import { describeOrderForAssistant, type MenuChoice, type OrderingOptions } from "@/lib/orders";
import { describeDay, describeHoursNow, isOpeningHours, WEEKDAYS } from "@/lib/opening-hours";
import { DEFAULT_HOLDING_REPLY, personalHoldingReply, type CompanyKind, type ReplyMode } from "@/lib/restaurant-setup";

// Everything the restaurant assistant reads for one answer (step 49), from
// the company's own data only (rule change 1, 2026-10-31): its details,
// hours, ordering notes, available dishes, up to 3 matching support
// articles, its categories, and the one conversation it answers. Also what
// ansa checks the reply against, and the settings the run needs.

// The articles the assistant reads: the best 3 hits, whole, within this many characters.
const KNOWLEDGE_HITS = 3;
const KNOWLEDGE_MAX_CHARACTERS = 3_000;

export type ConversationLine = AssistantContext["conversation"][number];

export type AssistantInputs = {
  kind: CompanyKind;
  context: AssistantContext;
  checkData: ReplyCheckData;
  restaurantName: string;
  holdingReply: string;
  replyMode: ReplyMode;
  categories: { id: string; name: string }[];
  // What ansa needs to write up an order itself (step 52).
  ordering: {
    takesOrders: boolean;
    // "Opens at 18:00" while the restaurant is closed now; null when open or no hours were given.
    closedNow: string | null;
    menu: MenuChoice[];
    options: OrderingOptions;
  };
};

// `conversationId`: the conversation answered, whose orders the assistant
// reads; none for "Test your assistant".
export async function gatherAssistantInputs(companyId: string, conversation: ConversationLine[], now = new Date(), conversationId?: string): Promise<AssistantInputs> {
  const [settings, company, facts, menu, categories, orders] = await Promise.all([
    getAssistantSettings(companyId),
    getCompanySetup(companyId),
    getBusinessFactsForCompany(companyId),
    listMenuItems(companyId),
    getActiveCategories(companyId),
    conversationId ? ordersOfConversation(companyId, conversationId) : Promise.resolve({ proposal: null, placed: [] }),
  ]);
  const fact = (topic: string) => facts.find((row) => row.topic === topic)?.confirmedValue ?? "";
  const currency = settings?.currency ?? "EUR";
  const kind = company.kind;
  // A person has no menu to quote (step 50).
  const available = kind === "personal" ? [] : menu.filter((item) => item.available);
  const lastCustomerText = [...conversation].reverse().find((line) => line.from === "customer")?.text ?? "";
  const hits = await searchKnowledge(companyId, { query: lastCustomerText, audience: "support", limit: KNOWLEDGE_HITS });
  const knowledge = buildKnowledgeSlice(hits, KNOWLEDGE_MAX_CHARACTERS);
  const restaurantName = fact("company_name") || company.companyName;
  const menuChoices = available.map((item, index) => ({ label: `M${index + 1}`, name: item.name, priceCents: item.priceCents }));
  const takesOrders = kind === "business" && (settings?.takesOrders ?? true);
  const deliveryFeeCents = settings?.delivery ? (settings.deliveryFeeCents ?? 0) : 0;
  const context: AssistantContext = {
    kind,
    restaurant: { name: restaurantName, description: fact("description"), address: fact("location"), phone: settings?.publicPhone ?? null },
    hours:
      kind === "personal"
        ? awayHoursFor(settings?.timeZone ?? null, settings?.awayHours ?? null, settings?.awaySince ?? null, now)
        : hoursFor(settings?.timeZone ?? null, settings?.openingHours ?? null, now),
    ordering: {
      delivery: settings?.delivery ?? false,
      deliveryNote: settings?.deliveryNote ?? "",
      pickup: settings?.pickup ?? true,
      paymentNote: settings?.paymentNote ?? "",
    },
    orders: {
      takesOrders,
      deliveryFee: deliveryFeeCents > 0 ? formatPrice(deliveryFeeCents, currency) : null,
      inProgress: orders.proposal ? describeOrderForAssistant(orders.proposal, menuChoices) : [],
      placed: orders.placed.map((order) => `#${order.orderNumber}: ${order.status}, ${describeOrderForAssistant(order, menuChoices).join(", ")}`),
    },
    menu: available.map((item, index) => ({
      label: `M${index + 1}`,
      category: item.category,
      name: item.name,
      description: item.description,
      price: formatPrice(item.priceCents, currency),
    })),
    instructions: settings?.instructions ?? "",
    knowledge: knowledge.text,
    categories: categories.map((category) => category.name),
    conversation,
  };
  const ownerTexts = [context.instructions, context.ordering.deliveryNote, context.ordering.paymentNote, context.restaurant.description, ...knowledge.hits.map((hit) => hit.text)];
  return {
    kind,
    context,
    // The delivery fee is an amount the assistant may name, like a menu price.
    checkData: { currency, menuPrices: [...available.map((item) => item.priceCents), ...(deliveryFeeCents > 0 ? [deliveryFeeCents] : [])], ownerTexts },
    restaurantName,
    holdingReply: settings?.holdingReply ?? (kind === "personal" ? personalHoldingReply(restaurantName) : DEFAULT_HOLDING_REPLY),
    replyMode: settings?.replyMode ?? "automatic",
    categories,
    ordering: {
      takesOrders,
      closedNow: takesOrders ? closedNowText(settings?.timeZone ?? null, settings?.openingHours ?? null, now) : null,
      menu: menuChoices,
      options: { delivery: settings?.delivery ?? false, pickup: settings?.pickup ?? true, deliveryFeeCents, currency },
    },
  };
}

// "Opens at 18:00" while the restaurant is closed now, by its own hours;
// null while open, or when it gave no hours (nothing to go by).
function closedNowText(timeZone: string | null, openingHours: unknown, now: Date): string | null {
  if (!timeZone || !isOpeningHours(openingHours)) {
    return null;
  }
  const today = describeHoursNow(openingHours, timeZone, now);
  return today.open ? null : today.text;
}

// The conversation as the assistant reads it: the newest text messages,
// oldest first; anything sent to the customer is "restaurant". Drafts,
// discarded and failed messages never reached the customer, so they're left out.
export async function conversationForAssistant(companyId: string, conversationId: string): Promise<ConversationLine[]> {
  const entries = await listConversationEntries(companyId, conversationId);
  const lines: ConversationLine[] = [];
  for (const entry of entries) {
    if (entry.bodyEncrypted === null || entry.sendStatus === "draft" || entry.sendStatus === "discarded" || entry.sendStatus === "failed") {
      continue;
    }
    const shown = decryptForDisplay(entry.bodyEncrypted, conversationMessageContext(companyId, entry.id));
    if (shown.text !== null) {
      lines.push({ from: entry.author === "customer" ? "customer" : "restaurant", text: shown.text });
    }
  }
  return lines.slice(-CONVERSATION_MESSAGES_FOR_AI);
}

function hoursFor(timeZone: string | null, openingHours: unknown, now: Date): AssistantContext["hours"] {
  if (!timeZone || !isOpeningHours(openingHours)) {
    return null;
  }
  const local = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  return {
    timeZone,
    now: `${local}, ${describeHoursNow(openingHours, timeZone, now).text.toLowerCase()}`,
    weekly: WEEKDAYS.map(({ key, label }) => `${label}: ${describeDay(openingHours[key])}`),
  };
}

// A person's availability as the assistant reads it (step 51): now in their
// zone, whether they said they're away, and their weekly away hours.
function awayHoursFor(timeZone: string | null, awayHours: unknown, awaySince: Date | null, now: Date): AssistantContext["hours"] {
  const zone = timeZone ?? "UTC";
  const local = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  const weekly = isOpeningHours(awayHours) ? WEEKDAYS.map(({ key, label }) => `Away on ${label}: ${describeDay(awayHours[key]) === "Closed" ? "no set hours" : describeDay(awayHours[key])}`) : [];
  return { timeZone: zone, now: `${local}${awaySince ? ", they said they are away" : ""}`, weekly };
}
