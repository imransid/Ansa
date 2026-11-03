import { z } from "zod";
import { CONVERSATION_CHANNELS } from "@/lib/conversations";
import { ORDER_NOT_TOLD_REASONS } from "@/lib/order-notices";

// What a status change the customer wasn't told about puts in the Orders
// page's address (app/actions/orders.ts): why, the customer's channel and
// the order's number. Anything else shows nothing at all: the page shows
// only its own words for a known reason, never text from the address.
export const ordersPageNoticeSchema = z.object({
  notTold: z.enum(ORDER_NOT_TOLD_REASONS),
  channel: z.enum(CONVERSATION_CHANNELS),
  order: z.coerce.number().int().min(1).max(2_147_483_647),
});
