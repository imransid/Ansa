import Link from "next/link";
import { MAX_IMPORTED_CHARACTERS } from "@/lib/knowledge/limits";

// What an import says once its drafts are saved (a web page here, a Setup
// document on the Setup page).
export function KnowledgeImportOutcome({ createdCount, wasCut }: { createdCount: number; wasCut: boolean }) {
  return (
    <p role="status" className="text-sm">
      {createdCount === 1 ? "Added 1 draft" : `Added ${createdCount} drafts`} to knowledge.{" "}
      {wasCut && `Only the first ${MAX_IMPORTED_CHARACTERS.toLocaleString("en-US")} characters were taken. `}
      <Link href="/knowledge?status=draft" className="font-medium underline">
        Read and approve {createdCount === 1 ? "it" : "them"}
      </Link>
    </p>
  );
}
