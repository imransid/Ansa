// Category limit checks: a company keeps at most ACTIVE_CATEGORIES_MAX (100)
// active categories, so creating or restoring one more is refused with a
// clear message, while one person can still tick every one of them; and
// setting a ticket's category while an owner renames that category answers
// "not found" instead of failing with a foreign key error. The rename's lock
// is held by an open transaction; nothing here calls an outside service.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { categories, userCategories } from "@/db/schema";
import { ACTIVE_CATEGORIES_MAX } from "@/lib/form-limits";
import {
  createCategoryForSession,
  getTeamCategoriesForSession,
  setCategoryArchivedForSession,
  setTicketCategoryForSession,
  setUserCategoriesForSession,
} from "@/services/categories";
import { createTicketForCompany } from "@/services/tickets";
import { holdLocks, isStillWaiting } from "./concurrency-checks";
import { check, sessionFor, signUpTestOwner } from "./helpers";
import { addCategory, storedTicket } from "./team-helpers";

const LIMIT_MESSAGE = `A company can have at most ${ACTIVE_CATEGORIES_MAX} active categories. Archive one first.`;

export async function runCategoryLimitChecks() {
  await check("categories: a company keeps at most 100 active ones; one more, created or restored, is refused with a clear message, and one person can handle all 100", async () => {
    const owner = await signUpTestOwner("category-limit");
    const asOwner = sessionFor(owner);
    const archivedId = await addCategory(owner, "Archived first");
    assert.deepEqual(await setCategoryArchivedForSession(asOwner, { categoryId: archivedId, archived: "true" }), { ok: true });
    // Straight into the table: the settings rate limit allows far fewer changes in a row.
    const names = Array.from({ length: ACTIVE_CATEGORIES_MAX }, (_, index) => ({ companyId: owner.companyId, name: `Category ${index + 1}` }));
    const active = await db.insert(categories).values(names).returning({ id: categories.id });

    assert.deepEqual(await createCategoryForSession(asOwner, { name: "One too many" }), { ok: false, errors: { fieldErrors: { name: [LIMIT_MESSAGE] } } });
    assert.deepEqual(await setCategoryArchivedForSession(asOwner, { categoryId: archivedId, archived: "false" }), { ok: false, errors: { message: LIMIT_MESSAGE } });
    const listed = (await getTeamCategoriesForSession(asOwner)).categories;
    assert.deepEqual([listed.filter((category) => !category.archived).length, listed.some((category) => category.name === "One too many")], [ACTIVE_CATEGORIES_MAX, false]);
    assert.equal(listed.find((category) => category.id === archivedId)?.archived, true);

    // A generalist ticks every one of them (the form's limit matches the company's).
    assert.deepEqual(await setUserCategoriesForSession(asOwner, { userId: owner.id, categoryIds: active.map((row) => row.id) }), { ok: true });
    assert.equal((await db.select().from(userCategories).where(eq(userCategories.userId, owner.id))).length, ACTIVE_CATEGORIES_MAX);

    // Archiving one makes room again.
    assert.deepEqual(await setCategoryArchivedForSession(asOwner, { categoryId: active[0].id, archived: "true" }), { ok: true });
    assert.deepEqual(await setCategoryArchivedForSession(asOwner, { categoryId: archivedId, archived: "false" }), { ok: true });
  });

  await check("categories: setting a ticket's category while an owner renames it answers 'not found', never a foreign key error", async () => {
    const owner = await signUpTestOwner("category-rename-race");
    const categoryId = await addCategory(owner, "Billing");
    const ticket = await createTicketForCompany(owner.companyId, { subject: "Rename race", description: "x", channel: "manual" });
    // The rename's own UPDATE, held open. A rename takes no lock that setting
    // a category waits for first, so the old name still looks usable.
    const release = await holdLocks((tx) => tx.update(categories).set({ name: "Payments" }).where(eq(categories.id, categoryId)));
    const saving = setTicketCategoryForSession(sessionFor(owner), { ticketId: ticket.id, category: "Billing" });
    const waited = await isStillWaiting(saving);
    await release();
    assert.ok(waited, "setting the category did not wait for the rename");
    assert.deepEqual(await saving, { ok: false, errors: { message: "That ticket or category was not found in your company." } });
    assert.equal((await storedTicket(ticket.id)).category, null);
  });
}
