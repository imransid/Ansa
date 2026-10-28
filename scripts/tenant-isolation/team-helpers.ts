// Shared pieces for the team control checks (step 23): people who never
// confirmed, categories, tickets, and what the database says about a person
// or a ticket.

import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { tickets, users } from "@/db/schema";
import { createCategoryForSession, getTeamCategoriesForSession } from "@/services/categories";
import { joinCompanyWithInvite } from "@/services/signup";
import { requestHeadersFrom, userIdsWithEmail } from "./account-helpers";
import { inviteAs, sessionFor, testEmail, testPassword, unconfirmedAccountIds, type TestUser } from "./helpers";

// Joins `owner`'s company through a real invite, the way the join form does,
// and never confirms the address.
export async function joinWithoutConfirming(owner: TestUser, label: string): Promise<{ id: string; email: string }> {
  const email = testEmail(label);
  const inviteToken = await inviteAs(owner, email, "member");
  const joinInput = { inviteToken, name: "Never confirmed", email, password: testPassword };
  assert.deepEqual(await joinCompanyWithInvite(joinInput, requestHeadersFrom(label)), { ok: true });
  const [id] = await userIdsWithEmail(email);
  unconfirmedAccountIds.push(id);
  return { id, email };
}

// Adds a category to the owner's company and returns its id.
export async function addCategory(owner: TestUser, name: string): Promise<string> {
  assert.deepEqual(await createCategoryForSession(sessionFor(owner), { name }), { ok: true });
  const { categories } = await getTeamCategoriesForSession(sessionFor(owner));
  return categories.find((category) => category.name === name)!.id;
}

export function newTicket(category?: string) {
  return { subject: "Team check", description: "x", channel: "phone", category };
}

export async function storedTicket(ticketId: string) {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  return ticket;
}

// A person's role, when they were removed (or null) and whether they confirmed.
export async function personRow(userId: string) {
  const [person] = await db
    .select({ role: users.role, removedAt: users.deactivatedAt, confirmed: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId));
  return person;
}

// As if an owner removed this person, but leaving everything else (sessions,
// reset links) in place: what a login or link slipping in while the removal
// was being saved would leave behind.
export async function markRemovedInDatabaseOnly(userId: string): Promise<void> {
  await db.update(users).set({ deactivatedAt: new Date() }).where(eq(users.id, userId));
}

// How many "a ticket is yours" emails the dev outbox wrote for this ticket.
export async function assignmentEmailCount(ticketId: string): Promise<number> {
  const outbox = await readdir(path.join(process.cwd(), ".dev-emails")).catch(() => [] as string[]);
  return outbox.filter((file) => file.includes(`ticket-assigned-${ticketId}-`)).length;
}
