// Operator tool: prints the forwarding address of an owner's company, the
// address its support mailbox must forward to (the same one its Setup page
// shows), after the company's name. Nobody links or chooses it: the database
// made it with the company. Only the address of an owner who confirmed it and
// was not removed finds a company (scripts/company-of-user.ts).
//
// Run against production from your machine (both settings on the command line
// win over .env.local):
//   INBOUND_EMAIL_DOMAIN=<production domain> DATABASE_URL="<direct url>" pnpm show:forwarding-address owner@theircompany.com
// Locally, the Setup page shows the address.

import { db } from "@/db/client";
import { getInboundTokenForCompany } from "@/db/inbound-emails";
import { env } from "@/lib/env";
import { buildForwardingAddress } from "@/lib/forwarding-address";
import { describeOwnersCompany, findOwnersCompany, noOwnerMessage } from "./company-of-user";

async function main() {
  const email = process.argv[2] ?? "";
  if (!email) {
    console.error("Usage: INBOUND_EMAIL_DOMAIN=<production domain> pnpm show:forwarding-address owner@theircompany.com");
    process.exitCode = 1;
    return;
  }
  // Without it the address would be on the development domain, which can't
  // receive mail: it would look right, and a company forwarding to it would
  // silently get nothing.
  if (!env.INBOUND_EMAIL_DOMAIN) {
    console.error('INBOUND_EMAIL_DOMAIN is not set. Run: INBOUND_EMAIL_DOMAIN=<production domain> DATABASE_URL="<direct url>" pnpm show:forwarding-address <owner email>');
    process.exitCode = 1;
    return;
  }
  const company = await findOwnersCompany(email);
  const token = company ? await getInboundTokenForCompany(company.companyId) : undefined;
  if (!company || !token) {
    console.error(noOwnerMessage(email));
    process.exitCode = 1;
    return;
  }
  console.log(describeOwnersCompany(company, email));
  console.log(buildForwardingAddress(token));
}

main()
  .catch((error) => {
    console.error("Lookup failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
