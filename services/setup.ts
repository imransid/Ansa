import "server-only";
import { z } from "zod";
import { updateCompanyName } from "@/db/companies";
import { getSetupStatus, setReplyToEmail, type SetupStatus } from "@/db/company-settings";
import { isUniqueViolation } from "@/db/errors";
import { createInboundAddress, deleteInboundAddress } from "@/db/inbound-emails";
import type { FormResult } from "@/lib/form-result";
import { buildForwardingAddress, isOnInboundEmailDomain } from "@/lib/forwarding-address";
import { isOurSendingAddress } from "@/lib/send-email";
import type { SessionContext } from "@/lib/session";
import { companyNameSettingSchema, inboundAddressSchema, replyToEmailSchema } from "@/lib/validation/setup";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// What the Setup page shows. The forwarding address is built here, so pages
// never handle the bare token.
export type SetupOverview = Omit<SetupStatus, "inboundToken"> & { forwardingAddress: string };

const ownersOnly: FormResult = { ok: false, errors: { message: "Only owners can change company setup." } };
const tooManyChanges: FormResult = { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };

// The checklist moved to lib/setup-checklist.ts (the page uses it with
// either backend); passed on for the dashboard and the checks.
export { buildSetupChecklist, type ChecklistItem } from "@/lib/setup-checklist";

// What the Setup page shows for the session's company, including its
// forwarding address. Phone numbers are read-only here: ansa links them.
export async function getSetupForSession(session: SessionContext): Promise<SetupOverview> {
  const { inboundToken, ...status } = await getSetupStatus(session.companyId);
  return { ...status, forwardingAddress: buildForwardingAddress(inboundToken) };
}

// Renames the session's company. It is also in the sender name of every
// customer email ("<name> via ansa"). Owners only.
export async function setCompanyNameForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const guard = await ownerGuard(session);
  if (guard) {
    return guard;
  }
  const parsed = companyNameSettingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  await updateCompanyName(session.companyId, parsed.data.companyName);
  return { ok: true };
}

// Sets (or clears) the company's Reply-To address for customer emails.
// Cleared, replies go to the company's forwarding address. Owners only.
export async function setReplyToEmailForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const guard = await ownerGuard(session);
  if (guard) {
    return guard;
  }
  const parsed = replyToEmailSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  const replyToEmail = parsed.data.replyToEmail;
  if (replyToEmail && isAnsaAddress(replyToEmail)) {
    return { ok: false, errors: { fieldErrors: { replyToEmail: ["That is one of ansa's addresses. Leave this empty and replies go to your forwarding address."] } } };
  }
  await setReplyToEmail(session.companyId, replyToEmail);
  return { ok: true };
}

// Adds an address the company's customers write to. It is shown on Setup and
// used to spot email the company's own mailbox sends back; it never decides
// where email goes (only the forwarding address does). Owners only.
export async function addInboundAddressForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const guard = await ownerGuard(session);
  if (guard) {
    return guard;
  }
  const parsed = inboundAddressSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  if (isAnsaAddress(parsed.data.address)) {
    return { ok: false, errors: { fieldErrors: { address: ["That is one of ansa's addresses. Add the address your customers write to, like support@yourcompany.com."] } } };
  }
  try {
    await createInboundAddress(session.companyId, parsed.data.address);
  } catch (error) {
    // Unique per company only: another company listing the same address
    // changes nothing here, and this answer never says whether one did.
    if (isUniqueViolation(error)) {
      return { ok: false, errors: { fieldErrors: { address: ["You already added that address."] } } };
    }
    throw error;
  }
  return { ok: true };
}

// Removes one of the company's support addresses from its list. Owners only.
export async function removeInboundAddressForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const guard = await ownerGuard(session);
  if (guard) {
    return guard;
  }
  const parsed = inboundAddressSchema.safeParse(input);
  if (!parsed.success || !(await deleteInboundAddress(session.companyId, parsed.data.address))) {
    return { ok: false, errors: { message: "Unknown address." } };
  }
  return { ok: true };
}

// Our shared sending address (EMAIL_FROM, in any letter case) and every
// address on our receiving domain belong to ansa, never to one company.
function isAnsaAddress(address: string): boolean {
  return isOurSendingAddress(address) || isOnInboundEmailDomain(address);
}

// Refuses members, and counts one attempt against the owner's
// "settings-changes" rate limit (so every call uses up a slot). Returns the
// refusal, or null to go on.
async function ownerGuard(session: SessionContext): Promise<FormResult | null> {
  if (session.role !== "owner") {
    return ownersOnly;
  }
  if (await isOverRateLimit("settings-changes", session.userId, RATE_LIMITS.settingsChangesPerUser)) {
    return tooManyChanges;
  }
  return null;
}
