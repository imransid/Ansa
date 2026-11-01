import "server-only";
import { eq, sql } from "drizzle-orm";
import type { AiEngine } from "@/lib/assistant/engine";
import { db } from "./client";
import { asRestaurantOwner, type SetupWriteOutcome } from "./restaurant-owner";
import { assistantSettings } from "./schema";

// The restaurant assistant's AI engine and the restaurant's own Claude API
// key (step 49, Settings → Assistant): owners only (asRestaurantOwner), the
// key stored encrypted with its last four characters beside it.

export type EngineRow = { aiEngine: AiEngine; anthropicKeyEncrypted: string | null; anthropicKeyHint: string | null };

// "keep": the key stays as it is; "remove": no key; else the new one.
export type KeyChange = "keep" | "remove" | { encrypted: string; hint: string };

export async function getAssistantEngine(companyId: string): Promise<EngineRow> {
  const [row] = await db
    .select({
      aiEngine: assistantSettings.aiEngine,
      anthropicKeyEncrypted: assistantSettings.anthropicKeyEncrypted,
      anthropicKeyHint: assistantSettings.anthropicKeyHint,
    })
    .from(assistantSettings)
    .where(eq(assistantSettings.companyId, companyId));
  return row ?? { aiEngine: "api_key", anthropicKeyEncrypted: null, anthropicKeyHint: null };
}

export async function saveAssistantEngine(companyId: string, actorUserId: string, engine: AiEngine, key: KeyChange): Promise<SetupWriteOutcome> {
  return asRestaurantOwner(companyId, actorUserId, async (tx) => {
    const keyColumns =
      key === "keep"
        ? {}
        : key === "remove"
          ? { anthropicKeyEncrypted: null, anthropicKeyHint: null }
          : { anthropicKeyEncrypted: key.encrypted, anthropicKeyHint: key.hint };
    const columns = { aiEngine: engine, ...keyColumns, updatedByUserId: actorUserId };
    await tx
      .insert(assistantSettings)
      .values({ companyId, ...columns })
      .onConflictDoUpdate({ target: assistantSettings.companyId, set: { ...columns, updatedAt: sql`now()` } });
  });
}
