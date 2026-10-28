// Shared by ansa's operator scripts (pnpm link:phone-line, unlink:phone-line,
// show:forwarding-address, replace:forwarding-address, simulate:inbound-email):
// finds the company of the OWNER with this email, and reads --yes.
//
// Looked up directly here, not through /db, on purpose: "find a company by
// email" is only safe in a script the operator runs by hand, never in the app.

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { companies, users } from "@/db/schema";

export type OwnersCompany = { companyId: string; companyName: string };

// The flag that lets a script change something. Without it, a script only
// shows which company it would change.
export const CONFIRM_FLAG = "--yes";

// The company of the owner with this email, or undefined when this address
// is not an owner who confirmed it and was not removed. Any other account
// with the address can belong to the wrong company: an invite an owner sent
// to someone else's address (or a typo) makes an account in the inviter's
// company, and whoever's company holds a phone line receives its calls.
export async function findOwnersCompany(email: string): Promise<OwnersCompany | undefined> {
  const [owner] = await db
    .select({ companyId: companies.id, companyName: companies.name })
    .from(users)
    .innerJoin(companies, eq(companies.id, users.companyId))
    .where(
      and(
        eq(users.email, email.trim().toLowerCase()),
        eq(users.role, "owner"),
        eq(users.emailVerified, true),
        isNull(users.deactivatedAt),
      ),
    );
  return owner;
}

// The arguments a script was given, without --yes, and whether --yes was one of them.
export function readOperatorArguments(argv: string[] = process.argv.slice(2)): { values: string[]; confirmed: boolean } {
  return { values: argv.filter((value) => value !== CONFIRM_FLAG), confirmed: argv.includes(CONFIRM_FLAG) };
}

// The one line every script prints about the company it found, before it acts.
export function describeOwnersCompany(company: OwnersCompany, email: string): string {
  return `Company: "${company.companyName}" (owner ${email.trim().toLowerCase()}, company id ${company.companyId})`;
}

// What a script prints instead of changing anything when --yes is missing.
export function askToConfirm(action: string): string {
  return `Nothing was changed. If this is the right company, run the same command again with ${CONFIRM_FLAG} to ${action}.`;
}

// What a script prints when the address is no confirmed, active owner.
export function noOwnerMessage(email: string): string {
  return `${email} is not the confirmed address of an owner (not removed) of any company. Nothing was changed.`;
}
