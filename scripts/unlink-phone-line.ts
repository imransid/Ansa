// Operator tool: unlinks a Vapi phone number id from a company (the undo of
// pnpm link:phone-line, e.g. after linking the wrong id). A number that already
// has calls stays linked: its calls need it (Postgres refuses the delete).
//
// Like linking, it finds the company only by the address of a confirmed,
// active owner, prints the company's name and changes nothing until it is
// run again with --yes.
//
// Run with: pnpm unlink:phone-line owner@theircompany.com <vapiPhoneNumberId> [--yes]
// Against production: DATABASE_URL="<direct url>" pnpm unlink:phone-line ...

import { db } from "@/db/client";
import { isForeignKeyViolation } from "@/db/errors";
import { deletePhoneLine } from "@/db/phone-lines";
import { vapiPhoneNumberIdSchema } from "@/lib/validation/vapi";
import { askToConfirm, describeOwnersCompany, findOwnersCompany, noOwnerMessage, readOperatorArguments } from "./company-of-user";

async function main() {
  const { values, confirmed } = readOperatorArguments();
  const email = values[0] ?? "";
  const vapiPhoneNumberId = vapiPhoneNumberIdSchema.safeParse(values[1]);
  if (!email || !vapiPhoneNumberId.success) {
    console.error("Usage: pnpm unlink:phone-line owner@theircompany.com <vapiPhoneNumberId> [--yes]");
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
    console.log(askToConfirm(`unlink ${vapiPhoneNumberId.data} from it`));
    process.exitCode = 1;
    return;
  }

  try {
    // Company-scoped: a number of another company is "not linked" here.
    const removed = await deletePhoneLine(company.companyId, vapiPhoneNumberId.data);
    console.log(removed ? `Unlinked ${vapiPhoneNumberId.data}.` : `"${company.companyName}" has no number ${vapiPhoneNumberId.data}.`);
    process.exitCode = removed ? 0 : 1;
  } catch (error) {
    if (!isForeignKeyViolation(error)) {
      throw error;
    }
    console.error("This number already has calls, so it stays linked.");
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("Unlinking failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
