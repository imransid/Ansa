// Operator tool: links a Vapi phone number id to the company of an owner, so
// calls to that number are saved for that company. Owners can't link numbers
// themselves (step 24): the numbers live in ansa's own Vapi account, and
// whoever links an id receives its calls.
//
// Only the address of an owner who confirmed it and was not removed finds a
// company (scripts/company-of-user.ts). The script first prints that company's
// name and changes nothing; check it is the company that asked, then run the
// same command again with --yes to link.
//
// Run with: pnpm link:phone-line owner@theircompany.com <vapiPhoneNumberId> [--yes]
// Against production: DATABASE_URL="<direct url>" pnpm link:phone-line ...
// For local testing any id works, e.g. "pn-local-test".
// Undo (only while the number has no calls): pnpm unlink:phone-line.

import { db } from "@/db/client";
import { createPhoneLine, findPhoneLineByVapiNumberId } from "@/db/phone-lines";
import { vapiPhoneNumberIdSchema } from "@/lib/validation/vapi";
import { askToConfirm, describeOwnersCompany, findOwnersCompany, noOwnerMessage, readOperatorArguments } from "./company-of-user";

async function main() {
  const { values, confirmed } = readOperatorArguments();
  const email = values[0] ?? "";
  const vapiPhoneNumberId = vapiPhoneNumberIdSchema.safeParse(values[1]);
  if (!email || !vapiPhoneNumberId.success) {
    console.error("Usage: pnpm link:phone-line owner@theircompany.com <vapiPhoneNumberId> [--yes]");
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

  const existing = await findPhoneLineByVapiNumberId(vapiPhoneNumberId.data);
  if (existing) {
    const sameCompany = existing.companyId === company.companyId;
    console.log(sameCompany ? "Already linked to this company." : "This number already belongs to another company.");
    process.exitCode = sameCompany ? 0 : 1;
    return;
  }
  // Exit code 1: nothing was linked, so a script calling this doesn't carry on as if it was.
  if (!confirmed) {
    console.log(askToConfirm(`link ${vapiPhoneNumberId.data} to it`));
    process.exitCode = 1;
    return;
  }

  await createPhoneLine(company.companyId, vapiPhoneNumberId.data);
  console.log(`Linked ${vapiPhoneNumberId.data} to "${company.companyName}". Its Setup page now shows the number.`);
}

main()
  .catch((error) => {
    console.error("Linking failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
