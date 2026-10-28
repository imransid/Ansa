import type { KnowledgeStatus } from "./kinds";

// Who may do what with a knowledge article (step 34). One place, read by the
// services and by /db (with the role read again, locked, inside the
// transaction that writes), and by the pages only to hide what would be
// refused anyway.

type Role = "owner" | "member";

// Anyone in the company writes and changes drafts. An approved article is
// what the AI uses, so only owners change it (it stays approved). Nobody
// edits an archived one: an owner restores it as a draft first.
export function canEditKnowledgeArticle(role: Role, status: KnowledgeStatus): boolean {
  if (status === "draft") {
    return true;
  }
  return status === "approved" && role === "owner";
}

// Approve, archive, restore, delete, and import documents and web pages.
export function canManageKnowledge(role: Role): boolean {
  return role === "owner";
}
