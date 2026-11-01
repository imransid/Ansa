import "server-only";
import { CHANNEL_LABELS, type ConversationChannel } from "@/lib/conversations";
import { newOrderTelegramNote, renderNewOrderEmail } from "@/lib/emails/new-order";
import { env } from "@/lib/env";
import { describeErrorWithFrames } from "@/lib/safe-error-logging";
import { emailOwners, noteInTelegram, type AlertOptions } from "./owner-alerts";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Tells the restaurant's owners that a customer placed an order (step 52),
// after it is saved: the same email and Telegram note as a "Needs you"
// alert (services/owner-alerts.ts), its number, who and ansa's total, and a
// link to the Orders page. Best effort: a failure is only logged.

export type NewOrderAlert = {
  companyId: string;
  conversationId: string;
  orderId: string;
  orderNumber: number;
  totalCents: number;
  currency: string;
  channel: ConversationChannel;
  customerName: string | null;
};

export async function alertOwnersOfOrder(alert: NewOrderAlert, options: AlertOptions = {}): Promise<void> {
  try {
    if (await isOverRateLimit("owner-alerts", alert.companyId, RATE_LIMITS.ownerAlertsPerCompany)) {
      console.warn("Owner alert skipped: hourly limit");
      return;
    }
    const fields = {
      orderNumber: alert.orderNumber,
      totalCents: alert.totalCents,
      currency: alert.currency,
      customerName: alert.customerName,
      channelLabel: CHANNEL_LABELS[alert.channel],
      link: `${env.BETTER_AUTH_URL}/orders`,
    };
    await emailOwners(alert.companyId, `new-order-${alert.orderId}`, (ownerName) => renderNewOrderEmail({ ownerName, ...fields }));
    await noteInTelegram(alert.companyId, newOrderTelegramNote(fields), options);
  } catch (error) {
    console.error(`Owner alert failed: ${describeErrorWithFrames(error)}`);
  }
}
