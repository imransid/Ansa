// Step 27, customer addresses: the looser customer check accepts real
// addresses Zod's default refuses (international domains, & = % ! # before
// the @) and stores the domain in ASCII, exactly as the ticket page previews
// it; team accounts keep the strict check; experts and owners can save such
// addresses; and From headers are read from the last <...> group, quoted
// names unescaped.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { tickets } from "@/db/schema";
import { normalizeEmailAddress } from "@/lib/email-address";
import { parseMailbox } from "@/lib/mailbox";
import { emailSchema } from "@/lib/validation/auth";
import { customerEmailSchema } from "@/lib/validation/customer-email";
import { addInboundAddressForSession, getSetupForSession, setReplyToEmailForSession } from "@/services/setup";
import { createTicketForCompany, setCustomerEmailForSession } from "@/services/tickets";
import { check, runId, sessionFor, signUpTestOwner } from "./helpers";

export async function runCustomerEmailChecks() {
  const owner = await signUpTestOwner("customer-addresses");

  await check("customer emails: international domains and & = % before the @ are accepted (domain in ASCII, as the page previews it); junk is refused", async () => {
    const accepted: [string, string][] = [
      ["ivan@почта.рф", "ivan@xn--80a1acny.xn--p1ai"],
      ["Info@例子.测试", "info@xn--fsqu00a.xn--0zwm56d"],
      ["user@MÜNCHEN.de", "user@xn--mnchen-3ya.de"],
      ["ivan@xn--80a1acny.xn--p1ai", "ivan@xn--80a1acny.xn--p1ai"],
      ["sales&support@shop.example", "sales&support@shop.example"],
      ["user=tag@example.com", "user=tag@example.com"],
      ["user%example.org@relay.example.com", "user%example.org@relay.example.com"],
      [" O'Brien+x@Example.com ", "o'brien+x@example.com"],
    ];
    for (const [input, stored] of accepted) {
      assert.equal(customerEmailSchema.parse(input), stored, input);
      assert.equal(normalizeEmailAddress(input), stored, `${input}: the page would preview another address`);
    }
    const refused = ["not-an-email", "user@localhost", "josé@example.com", "a@example.com/x", "a@ex%41mple.com", "a@b@c.com", "a b@example.com", "", `${"a".repeat(250)}@example.com`];
    for (const input of refused) {
      assert.equal(customerEmailSchema.safeParse(input).success, false, `accepted: ${input}`);
    }
  });

  await check("customer emails: team accounts keep the strict check", async () => {
    for (const input of ["sales&support@shop.example", "ivan@почта.рф", "user=tag@example.com"]) {
      assert.equal(emailSchema.safeParse(input).success, false, input);
    }
    assert.equal(emailSchema.parse(" Ana@Example.com "), "ana@example.com");
  });

  await check("customer emails: experts save such an address on a ticket; owners use one as support and reply-to address", async () => {
    const asOwner = sessionFor(owner);
    const ticket = await createTicketForCompany(owner.companyId, { subject: "Address check", description: "x", channel: "email" });
    assert.deepEqual(await setCustomerEmailForSession(asOwner, { ticketId: ticket.id, customerEmail: "Ivan@Почта.рф", confirmed: "yes" }), { ok: true });
    const [saved] = await db.select().from(tickets).where(eq(tickets.id, ticket.id));
    assert.equal(saved.customerEmail, "ivan@xn--80a1acny.xn--p1ai");
    assert.deepEqual(await setCustomerEmailForSession(asOwner, { ticketId: ticket.id, customerEmail: "sales&support@shop.example", confirmed: "yes" }), { ok: true });
    assert.deepEqual(await addInboundAddressForSession(asOwner, { address: `help-${runId}@почта.рф` }), { ok: true });
    assert.deepEqual(await setReplyToEmailForSession(asOwner, { replyToEmail: `replies-${runId}@почта.рф` }), { ok: true });
    const setup = await getSetupForSession(asOwner);
    assert.equal(setup.replyToEmail, `replies-${runId}@xn--80a1acny.xn--p1ai`);
    assert.ok(setup.inboundAddresses.includes(`help-${runId}@xn--80a1acny.xn--p1ai`));
  });

  await check("mailbox parsing: the address is the last <...> group, quoted names are unescaped, 'address (Name)' works, names are one line of at most 200", async () => {
    assert.deepEqual(parseMailbox('"Sam \\"Ace\\" Okafor" <Sam@Example.com>'), { name: 'Sam "Ace" Okafor', address: "sam@example.com" });
    assert.deepEqual(parseMailbox('Sam "Ace" Okafor <sam@example.com>'), { name: 'Sam "Ace" Okafor', address: "sam@example.com" });
    assert.deepEqual(parseMailbox('"Sam <Ace>" <sam@example.com>'), { name: "Sam <Ace>", address: "sam@example.com" });
    assert.deepEqual(parseMailbox("sam@example.com (Sam Okafor)"), { name: "Sam Okafor", address: "sam@example.com" });
    assert.deepEqual(parseMailbox("Okafor, Sam <sam@example.com>"), { name: "Okafor, Sam", address: "sam@example.com" });
    assert.deepEqual(parseMailbox("SAM@EXAMPLE.COM"), { name: null, address: "sam@example.com" });
    assert.deepEqual(parseMailbox(""), { name: null, address: "" });
    const longName = parseMailbox(`"${"N".repeat(300)}\r\nBcc: x" <sam@example.com>`).name ?? "";
    assert.ok(longName.length === 200 && !/[\r\n]/.test(longName), longName.slice(-20));
  });
}
