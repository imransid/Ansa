// Adds sample tickets to an existing user's company, so the dashboard has
// something to show before real calls create tickets (step 7).
//
// Run with: pnpm seed:tickets you@example.com
// Running it again adds another batch with the next ticket numbers.

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { createTicketForCompany } from "@/services/tickets";

// Fictional customers. Phone numbers use the 555-01xx range reserved for fiction.
const SAMPLE_TICKETS = [
  {
    subject: "Order arrived damaged",
    description: "Customer received order with a cracked screen. Wants a replacement, not a refund.",
    channel: "phone",
    customerName: "Maria Lopez",
    customerPhone: "+1 555 0101",
  },
  {
    subject: "Charged twice for one order",
    description: "Two identical charges on the card statement. AI could not see payment details.",
    channel: "email",
    customerName: "Tom Becker",
    customerEmail: "tom.becker@example.com",
  },
  {
    subject: "Cannot log in after password reset",
    description: "Reset link worked, but the new password is rejected. Tried twice on the call.",
    channel: "phone",
    customerPhone: "+1 555 0102",
  },
  {
    subject: "Wants to change delivery address",
    description: "Order already shipped. Customer moved last week and needs it redirected.",
    channel: "email",
    customerEmail: "sam.okafor@example.com",
  },
  {
    subject: "Invoice needs company VAT number",
    description: "Business customer needs the invoice reissued with their VAT number on it.",
    channel: "email",
    customerName: "Lena Fischer",
    customerEmail: "lena@fischer-gmbh.example.com",
  },
  {
    subject: "Product stopped working after update",
    description: "Device stuck on the logo screen since last night's update. Restart did not help.",
    channel: "phone",
    customerName: "Ahmed Khan",
    customerPhone: "+1 555 0103",
  },
  {
    subject: "Asking for a bulk discount",
    description: "Wants 200 units for a school. AI is not allowed to offer custom pricing.",
    channel: "phone",
    customerName: "Grace Kim",
    customerPhone: "+1 555 0104",
    customerEmail: "g.kim@school.example.com",
  },
  {
    subject: "Unhappy with the last support call",
    description: "Customer asked to speak to a human about a previous call. Calm but firm.",
    channel: "phone",
  },
];

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: pnpm seed:tickets you@example.com");
    process.exitCode = 1;
    return;
  }

  // Looked up directly here, not through /db, on purpose: "find a company by
  // email" is only safe in a local dev script, so it should not exist as an app function.
  const [user] = await db
    .select({ companyId: users.companyId })
    .from(users)
    .where(eq(users.email, email));

  if (!user) {
    console.error(`No user with email ${email}. Sign up in the app first.`);
    process.exitCode = 1;
    return;
  }

  for (const sample of SAMPLE_TICKETS) {
    const ticket = await createTicketForCompany(user.companyId, sample);
    console.log(`Created ticket #${ticket.ticketNumber}: ${ticket.subject}`);
  }
}

main()
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
