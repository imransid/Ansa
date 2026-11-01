import type { ConversationChannel } from "@/lib/conversations";
import type { Fulfilment, OrderStatus } from "@/lib/orders";

// Orders (step 52) as stored, and as the Orders page shows them: the
// address and the customer's notes decrypted for the company's own team.

export type OrderRow = {
  id: string;
  conversationId: string;
  orderNumber: number | null;
  status: OrderStatus;
  fulfilment: Fulfilment;
  addressEncrypted: string | null;
  notesEncrypted: string | null;
  wantedTime: string;
  currency: string;
  deliveryFeeCents: number;
  totalCents: number;
  placedAt: Date | null;
  contactName: string | null;
  channel: ConversationChannel;
  lines: { name: string; quantity: number; lineTotalCents: number }[];
};

export type OrderView = Omit<OrderRow, "addressEncrypted" | "notesEncrypted"> & { address: string | null; notes: string | null };
