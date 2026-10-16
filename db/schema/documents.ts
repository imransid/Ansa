import { foreignKey, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { companies } from "./companies";

// A file an owner uploaded during setup (step 16): FAQs, policies, manuals.
// The file itself is in PRIVATE storage (lib/file-storage.ts). The AI does not
// read these yet; that needs its own step.
export const companyDocuments = pgTable(
  "company_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // What the owner called it, shown in lists. Never used in the storage key.
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // Built from ids only: documents/<companyId>/<documentId>.<ext>
    storageKey: text("storage_key").notNull().unique(),
    uploadedByUserId: text("uploaded_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "company_documents_uploader_in_same_company_fk",
      columns: [table.companyId, table.uploadedByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
  ],
);
