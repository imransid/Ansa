import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
// Relative paths on purpose: drizzle-kit reads this file outside Next.js.
import type { PostKind } from "../../lib/autopost/brain";
import type { AutopostSlotStatus } from "../../lib/autopost/slots";
import { companies } from "./companies";
import { contentDrafts } from "./content-drafts";

// One post "Post for me" plans (step 54): the posting moment it is for
// (unique per company: two runners claim it once), what ansa's brain chose
// (lib/autopost/brain.ts), and what became of it: the draft it wrote
// (same-company foreign key), scheduled in the publishing queue or waiting
// for an owner, or skipped with a code (lib/autopost/slots.ts). Plain
// text, like the drafts: the business's own marketing.
export const autopostSlots = pgTable(
  "autopost_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    postAt: timestamp("post_at", { withTimezone: true }).notNull(),
    status: text("status").$type<AutopostSlotStatus>().notNull().default("writing"),
    kind: text("kind").$type<PostKind>().notNull(),
    topic: text("topic").notNull(),
    itemName: text("item_name").notNull().default(""),
    specialDay: text("special_day").notNull().default(""),
    draftId: uuid("draft_id"),
    // Why it was skipped: a code (lib/autopost/slots.ts), never a model's words.
    skipReason: text("skip_reason"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("autopost_slots_company_post_at_unique").on(table.companyId, table.postAt),
    index("autopost_slots_company_created_idx").on(table.companyId, table.createdAt),
    foreignKey({
      name: "autopost_slots_draft_in_same_company_fk",
      columns: [table.companyId, table.draftId],
      foreignColumns: [contentDrafts.companyId, contentDrafts.id],
    }),
    check("autopost_slots_status_known", sql`${table.status} IN ('writing', 'scheduled', 'waiting_approval', 'skipped')`),
    check("autopost_slots_kind_known", sql`${table.kind} IN ('spotlight', 'behind_the_scenes', 'question', 'visit_us', 'tip', 'special_day')`),
    check("autopost_slots_topic_length", sql`char_length(${table.topic}) BETWEEN 1 AND 200`),
    check("autopost_slots_skip_reason_known", sql`(${table.status} = 'skipped') = (${table.skipReason} IS NOT NULL)`),
    check("autopost_slots_draft_once_written", sql`${table.status} NOT IN ('scheduled', 'waiting_approval') OR ${table.draftId} IS NOT NULL`),
  ],
);
