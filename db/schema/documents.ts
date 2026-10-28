import { foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { companies } from "./companies";

// A file an owner uploaded during setup (step 16): FAQs, policies, manuals.
// The file itself is in PRIVATE storage (lib/file-storage.ts). The AI never
// reads the file: "Add to knowledge" (step 34) turns its text into draft
// articles (knowledge.ts), which an owner approves.
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
    // The Setup page lists one company's documents newest first and counts
    // them; without it that reads every company's documents.
    index("company_documents_company_id_created_at_idx").on(table.companyId, table.createdAt),
    // id is already unique. This pair lets knowledge_articles use a
    // (company_id, source_document_id) foreign key.
    unique("company_documents_company_id_id_unique").on(table.companyId, table.id),
  ],
);
