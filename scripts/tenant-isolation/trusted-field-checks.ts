// Trusted-field checks (step 26): an insert or update in /db writes the
// company it was given, and every other column it decides itself, even when
// the object passed in carries a companyId, an outcome, a status or a ticket
// of its own. An invite's creator must be in its company (a database foreign
// key). A received email's ticket is only made while the email is being
// processed, so a second run never makes a second ticket.
// The objects are built in a variable first: TypeScript only refuses extra
// fields on objects written straight into the call.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { saveCompanySubscription } from "@/db/billing";
import { insertCallIfNew } from "@/db/calls";
import { db } from "@/db/client";
import { insertCompanyDocument } from "@/db/documents";
import { saveInboundEmailTicket } from "@/db/inbound-email-processing";
import { insertInboundEmailIfNew } from "@/db/inbound-emails";
import { createInvite } from "@/db/invites";
import { createPhoneLine } from "@/db/phone-lines";
import { calls, companies, companyBilling, companyDocuments, inboundEmails, invites } from "@/db/schema";
import { generateInviteToken, hashInviteToken } from "@/lib/invite-token";
import { assertRefusedByConstraint, check, runId, signUpTestOwner, type TestUser } from "./helpers";

function inAWeek(): Date {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

async function lastTicketNumberOf(user: TestUser): Promise<number> {
  const [company] = await db.select({ last: companies.lastTicketNumber }).from(companies).where(eq(companies.id, user.companyId));
  return company.last;
}

export async function runTrustedFieldChecks() {
  const ownerA = await signUpTestOwner("trusted-a");
  const ownerB = await signUpTestOwner("trusted-b");

  await check("trusted fields: a call is saved for the company given, whatever companyId or outcome the object carries", async () => {
    const line = await createPhoneLine(ownerA.companyId, `pn-trusted-${runId}`);
    const call = { phoneLineId: line.id, vapiCallId: `call-trusted-${runId}`, callerNumber: null, startedAt: null, endedAt: null, endedReason: null, transcriptEncrypted: null };
    const callWithExtras = { ...call, companyId: ownerB.companyId, analysisStatus: "decided", aiOutcome: "solved" };
    const callId = await insertCallIfNew(ownerA.companyId, callWithExtras);
    assert.ok(callId, "the call was not saved");
    const [row] = await db.select().from(calls).where(eq(calls.id, callId));
    assert.deepEqual([row.companyId, row.analysisStatus, row.aiOutcome], [ownerA.companyId, "pending", null]);
  });

  await check("trusted fields: a document and an invite are saved for the company given, never one inside the object", async () => {
    const document = {
      id: randomUUID(),
      fileName: "notes.txt",
      contentType: "text/plain",
      sizeBytes: 1,
      storageKey: `documents/${ownerA.companyId}/trusted-${runId}.txt`,
      uploadedByUserId: ownerA.id,
    };
    const documentWithCompany = { ...document, companyId: ownerB.companyId };
    await insertCompanyDocument(ownerA.companyId, documentWithCompany);
    const [storedDocument] = await db.select().from(companyDocuments).where(eq(companyDocuments.id, document.id));
    assert.equal(storedDocument.companyId, ownerA.companyId);

    const invite = {
      email: `trusted-invitee-${runId}@example.test`,
      role: "member" as const,
      tokenHash: hashInviteToken(generateInviteToken()),
      createdByUserId: ownerA.id,
      expiresAt: inAWeek(),
    };
    const inviteWithCompany = { ...invite, companyId: ownerB.companyId };
    const created = await createInvite(ownerA.companyId, inviteWithCompany);
    assert.ok(created, "the invite was not saved");
    const [storedInvite] = await db.select().from(invites).where(eq(invites.id, created.id));
    assert.equal(storedInvite.companyId, ownerA.companyId);
  });

  await check("trusted fields: a subscription is saved for the company given, never a companyId inside the snapshot", async () => {
    const snapshot = {
      stripeCustomerId: `cus_trusted_${runId}`,
      stripeSubscriptionId: `sub_trusted_${runId}`,
      status: "active" as const,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    };
    const snapshotWithCompany = { ...snapshot, companyId: ownerB.companyId };
    assert.equal(await saveCompanySubscription(ownerA.companyId, snapshotWithCompany), true);
    const rows = await db.select().from(companyBilling).where(eq(companyBilling.stripeSubscriptionId, snapshot.stripeSubscriptionId));
    assert.deepEqual(rows.map((row) => row.companyId), [ownerA.companyId]);
  });

  await check("invites: the database refuses a creator from another company", async () => {
    await assertRefusedByConstraint(
      db.insert(invites).values({
        companyId: ownerB.companyId,
        email: `trusted-fk-${runId}@example.test`,
        role: "member",
        tokenHash: hashInviteToken(generateInviteToken()),
        createdByUserId: ownerA.id,
        expiresAt: inAWeek(),
      }),
      "invites_creator_in_same_company_fk",
    );
  });

  await check("received email: its ticket is made only while it is being processed, once, with the status and ticket /db decides", async () => {
    const emailId = await insertInboundEmailIfNew(ownerA.companyId, `trusted-${runId}`);
    assert.ok(emailId, "the email was not recorded");
    const content = {
      fromAddress: `pat-${runId}@customer.test`,
      senderVerified: false,
      replyToAddress: null,
      subjectEncrypted: "v1:x:y:z",
      bodyEncrypted: null,
      bodyFromHtml: false,
      attachmentCount: 0,
      attachmentNamesEncrypted: null,
      inlineImageCount: 0,
    };
    const ticket = { subject: "Trusted", description: "x", channel: "email" as const, category: null, customerName: null, customerEmail: null, customerPhone: null };
    const numberBefore = await lastTicketNumberOf(ownerA);
    // Still "received": nobody claimed it, so no ticket and no ticket number used up.
    assert.equal(await saveInboundEmailTicket(ownerA.companyId, emailId, content, ticket), undefined);
    assert.equal(await lastTicketNumberOf(ownerA), numberBefore);

    await db.update(inboundEmails).set({ status: "processing", processingStartedAt: new Date() }).where(eq(inboundEmails.id, emailId));
    const contentWithExtras = { ...content, status: "ignored", ticketId: randomUUID(), companyId: ownerB.companyId };
    const saved = await saveInboundEmailTicket(ownerA.companyId, emailId, contentWithExtras, ticket);
    assert.ok(saved, "no ticket for an email being processed");
    const [row] = await db.select().from(inboundEmails).where(eq(inboundEmails.id, emailId));
    assert.deepEqual([row.status, row.ticketId, row.companyId], ["ticketed", saved.ticketId, ownerA.companyId]);
    // A second run for the same email makes no second ticket.
    assert.equal(await saveInboundEmailTicket(ownerA.companyId, emailId, content, ticket), undefined);
    assert.equal(await lastTicketNumberOf(ownerA), numberBefore + 1);
  });
}
