// Category checks (step 10): only owners manage the list, people pick their
// own categories (owners anyone's), and categories never cross companies,
// neither through the services nor in the database.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { categories, tickets, userCategories } from "@/db/schema";
import {
  createCategoryForSession,
  getTeamCategoriesForSession,
  renameCategoryForSession,
  setCategoryArchivedForSession,
  setTicketCategoryForSession,
  setUserCategoriesForSession,
} from "@/services/categories";
import { createTicketForCompany } from "@/services/tickets";
import { addTeammate, assertRefusedByConstraint, check, sessionFor, type TestUser } from "./helpers";

async function categoryId(companyId: string, name: string): Promise<string> {
  const { categories: list } = await getTeamCategoriesForSession({ companyId, userId: "", role: "member", name: "", email: "" });
  const found = list.find((category) => category.name === name);
  assert.ok(found, `no category ${name}`);
  return found.id;
}

export async function runCategoryChecks(ownerA: TestUser, ownerB: TestUser) {
  const memberA = await addTeammate(ownerA, "category-member", "member");
  const otherMemberA = await addTeammate(ownerA, "category-other", "member");
  const asOwnerA = sessionFor(ownerA);

  await check("categories: owners add them; duplicates in any letter case are refused", async () => {
    assert.equal((await createCategoryForSession(asOwnerA, { name: "Billing" })).ok, true);
    assert.equal((await createCategoryForSession(asOwnerA, { name: " Shipping " })).ok, true);
    assert.equal((await createCategoryForSession(asOwnerA, { name: "billing" })).ok, false);
    assert.equal((await createCategoryForSession(asOwnerA, { name: "<script>" })).ok, false);
    // Company B may have its own "Billing".
    assert.equal((await createCategoryForSession(sessionFor(ownerB), { name: "Billing" })).ok, true);
  });

  await check("categories: members cannot add, rename or archive", async () => {
    const billingId = await categoryId(ownerA.companyId, "Billing");
    const asMember = sessionFor(memberA);
    assert.equal((await createCategoryForSession(asMember, { name: "Refunds" })).ok, false);
    assert.equal((await renameCategoryForSession(asMember, { categoryId: billingId, name: "Money" })).ok, false);
    assert.equal((await setCategoryArchivedForSession(asMember, { categoryId: billingId, archived: "true" })).ok, false);
  });

  await check("categories: another company's owner cannot touch them", async () => {
    const billingId = await categoryId(ownerA.companyId, "Billing");
    const asOwnerB = sessionFor(ownerB);
    assert.equal((await renameCategoryForSession(asOwnerB, { categoryId: billingId, name: "Stolen" })).ok, false);
    assert.equal((await setCategoryArchivedForSession(asOwnerB, { categoryId: billingId, archived: "true" })).ok, false);
  });

  await check("categories: renaming follows through to tickets", async () => {
    assert.equal((await createCategoryForSession(asOwnerA, { name: "Returns" })).ok, true);
    const ticket = await createTicketForCompany(ownerA.companyId, { subject: "Rename me", description: "x", channel: "phone", category: "Returns" });
    const returnsId = await categoryId(ownerA.companyId, "Returns");
    assert.equal((await renameCategoryForSession(asOwnerA, { categoryId: returnsId, name: "Returns and refunds" })).ok, true);
    const [renamed] = await db.select().from(tickets).where(eq(tickets.id, ticket.id));
    assert.equal(renamed.category, "Returns and refunds");
  });

  await check("categories: people pick their own; owners can pick for anyone; members can't for others", async () => {
    const billingId = await categoryId(ownerA.companyId, "Billing");
    assert.equal((await setUserCategoriesForSession(sessionFor(memberA), { userId: memberA.id, categoryIds: [billingId] })).ok, true);
    assert.equal((await setUserCategoriesForSession(sessionFor(memberA), { userId: otherMemberA.id, categoryIds: [billingId] })).ok, false);
    assert.equal((await setUserCategoriesForSession(asOwnerA, { userId: otherMemberA.id, categoryIds: [billingId] })).ok, true);
    const links = await db.select().from(userCategories).where(eq(userCategories.categoryId, billingId));
    assert.deepEqual(links.map((link) => link.userId).sort(), [memberA.id, otherMemberA.id].sort());
  });

  await check("categories: nobody can pick another company's, archived, or for another company's person", async () => {
    const billingB = await categoryId(ownerB.companyId, "Billing");
    const shippingA = await categoryId(ownerA.companyId, "Shipping");
    assert.equal((await setUserCategoriesForSession(sessionFor(memberA), { userId: memberA.id, categoryIds: [billingB] })).ok, false);
    assert.equal((await setUserCategoriesForSession(asOwnerA, { userId: ownerB.id, categoryIds: [shippingA] })).ok, false);
    await setCategoryArchivedForSession(asOwnerA, { categoryId: shippingA, archived: "true" });
    assert.equal((await setUserCategoriesForSession(sessionFor(memberA), { userId: memberA.id, categoryIds: [shippingA] })).ok, false);
    await setCategoryArchivedForSession(asOwnerA, { categoryId: shippingA, archived: "false" });
    await assertRefusedByConstraint(
      db.insert(userCategories).values({ companyId: ownerA.companyId, userId: memberA.id, categoryId: billingB }),
      "user_categories_category_in_same_company_fk",
    );
  });

  await check("categories: a ticket only takes an active category of its own company", async () => {
    const ticket = await createTicketForCompany(ownerA.companyId, { subject: "Category guard", description: "x", channel: "phone" });
    assert.equal((await setTicketCategoryForSession(asOwnerA, { ticketId: ticket.id, category: "Made up" })).ok, false);
    assert.equal((await setTicketCategoryForSession(sessionFor(ownerB), { ticketId: ticket.id, category: "Billing" })).ok, false);
    const shippingA = await categoryId(ownerA.companyId, "Shipping");
    await setCategoryArchivedForSession(asOwnerA, { categoryId: shippingA, archived: "true" });
    assert.equal((await setTicketCategoryForSession(asOwnerA, { ticketId: ticket.id, category: "Shipping" })).ok, false);
    await setCategoryArchivedForSession(asOwnerA, { categoryId: shippingA, archived: "false" });
    await assertRefusedByConstraint(
      db.update(tickets).set({ category: "Only in B" }).where(eq(tickets.id, ticket.id)),
      "tickets_category_in_same_company_fk",
    );
    const [stillEmpty] = await db.select().from(tickets).where(eq(tickets.id, ticket.id));
    assert.equal(stillEmpty.category, null);
    assert.ok((await db.select().from(categories).where(eq(categories.companyId, ownerA.companyId))).length >= 3);
  });
}
