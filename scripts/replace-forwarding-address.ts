// Operator tool: gives an owner's company a NEW forwarding address, for when
// its current one gets spam. The address is not secret (it is the Reply-To of
// the company's "solved" emails), and companies can't change it themselves.
//
// The old address stops working at once: the company must forward its support
// mailbox to the new one (Gmail asks to confirm that again), and customer
// replies to emails sent before the change no longer arrive. So the script
// first prints the company's name and changes nothing; run the same command
// again with --yes to replace it. Only the address of an owner who confirmed
// it and was not removed finds a company (scripts/company-of-user.ts).
//
// Run against production from your machine (both settings on the command line
// win over .env.local):
//   INBOUND_EMAIL_DOMAIN=<production domain> DATABASE_URL="<direct url>" pnpm replace:forwarding-address owner@theircompany.com [--yes]

import { db } from "@/db/client";
import { replaceInboundTokenForCompany } from "@/db/inbound-emails";
import { env } from "@/lib/env";
import { buildForwardingAddress } from "@/lib/forwarding-address";
import { askToConfirm, describeOwnersCompany, findOwnersCompany, noOwnerMessage, readOperatorArguments } from "./company-of-user";

async function main() {
  const { values, confirmed } = readOperatorArguments();
  const email = values[0] ?? "";
  if (!email) {
    console.error("Usage: INBOUND_EMAIL_DOMAIN=<production domain> pnpm replace:forwarding-address owner@theircompany.com [--yes]");
    process.exitCode = 1;
    return;
  }
  // Checked before anything changes: without it the new address would be
  // printed on the development domain, which can't receive mail.
  if (!env.INBOUND_EMAIL_DOMAIN) {
    console.error('INBOUND_EMAIL_DOMAIN is not set. Run: INBOUND_EMAIL_DOMAIN=<production domain> DATABASE_URL="<direct url>" pnpm replace:forwarding-address <owner email>');
    process.exitCode = 1;
    return;
  }
  const company = await findOwnersCompany(email);
  if (!company) {
    console.error(noOwnerMessage(email));
    process.exitCode = 1;
    return;
  }
  console.log(describeOwnersCompany(company, email));
  if (!confirmed) {
    console.log(askToConfirm("give it a new forwarding address (the old one stops working at once)"));
    process.exitCode = 1;
    return;
  }
  const token = await replaceInboundTokenForCompany(company.companyId);
  if (!token) {
    console.error("The company was not found any more. Nothing was changed.");
    process.exitCode = 1;
    return;
  }
  console.log(`New forwarding address: ${buildForwardingAddress(token)}`);
  console.log("The old one no longer works. The company must forward its support mailbox to the new one.");
}

main()
  .catch((error) => {
    console.error("Replacing failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
