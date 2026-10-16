import "server-only";
import { z } from "zod";
import { getSetupStatus, setReplyToEmail, type SetupStatus } from "@/db/company-settings";
import { isForeignKeyViolation, isUniqueViolation } from "@/db/errors";
import { createInboundAddress, deleteInboundAddress } from "@/db/inbound-emails";
import { createPhoneLine, deletePhoneLine } from "@/db/phone-lines";
import type { FormResult } from "@/lib/form-result";
import type { SessionContext } from "@/lib/session";
import { inboundAddressSchema, phoneLineSchema, replyToEmailSchema } from "@/lib/validation/setup";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

export type { SetupStatus };

const ownersOnly: FormResult = { ok: false, errors: { message: "Only owners can change company setup." } };
const tooManyChanges: FormResult = { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };

// What the setup checklist shows for the session's company.
export async function getSetupForSession(session: SessionContext): Promise<SetupStatus> {
  return getSetupStatus(session.companyId);
}

// Sets (or clears) the company's Reply-To address for customer emails. Owners only.
export async function setReplyToEmailForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const guard = await ownerGuard(session);
  if (guard) {
    return guard;
  }
  const parsed = replyToEmailSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  await setReplyToEmail(session.companyId, parsed.data.replyToEmail);
  return { ok: true };
}

// Links a Vapi phone number to the session's company. Owners only.
export async function addPhoneLineForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const guard = await ownerGuard(session);
  if (guard) {
    return guard;
  }
  const parsed = phoneLineSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  try {
    await createPhoneLine(session.companyId, parsed.data.vapiPhoneNumberId);
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Same message whether it is ours or another company's: never reveal which.
      return { ok: false, errors: { fieldErrors: { vapiPhoneNumberId: ["That number is already in use."] } } };
    }
    throw error;
  }
  return { ok: true };
}

// Links an inbound support address to the session's company. Owners only.
export async function addInboundAddressForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const guard = await ownerGuard(session);
  if (guard) {
    return guard;
  }
  const parsed = inboundAddressSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  try {
    await createInboundAddress(session.companyId, parsed.data.address);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, errors: { fieldErrors: { address: ["That address is already in use."] } } };
    }
    throw error;
  }
  return { ok: true };
}

// Unlinks one of the company's phone numbers, unless it already has calls
// (they must keep their number). Owners only.
export async function removePhoneLineForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const guard = await ownerGuard(session);
  if (guard) {
    return guard;
  }
  const parsed = phoneLineSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Unknown phone number." } };
  }
  try {
    const removed = await deletePhoneLine(session.companyId, parsed.data.vapiPhoneNumberId);
    return removed ? { ok: true } : { ok: false, errors: { message: "Unknown phone number." } };
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      return { ok: false, errors: { message: "This number already has calls, so it stays linked." } };
    }
    throw error;
  }
}

// Unlinks one of the company's support addresses. Owners only.
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

async function ownerGuard(session: SessionContext): Promise<FormResult | null> {
  if (session.role !== "owner") {
    return ownersOnly;
  }
  if (await isOverRateLimit("settings-changes", session.userId, RATE_LIMITS.settingsChangesPerUser)) {
    return tooManyChanges;
  }
  return null;
}
