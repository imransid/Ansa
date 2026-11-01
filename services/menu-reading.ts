import "server-only";
import { askClaudeForMenuReading } from "@/adapters/claude";
import { askStandInForMenuReading } from "@/adapters/dev-menu-reader";
import { getAssistantSettings } from "@/db/assistant-settings";
import { checkDocumentFile, MAX_DOCUMENT_BYTES, TOO_BIG_MESSAGE } from "@/lib/document-files";
import { extractDocumentText } from "@/lib/knowledge/extract-text";
import { detectMediaType, SIGNATURE_BYTES } from "@/lib/media/signatures";
import { menuStandInAllowed } from "@/lib/menu";
import { readMenuReadingAnswer, type ProposedMenuItem } from "@/lib/menu-reading/answer";
import { buildMenuPhotoPrompt, buildMenuTextPrompt, MENU_READING_JSON_SCHEMA, MENU_READING_SYSTEM_PROMPT } from "@/lib/menu-reading/prompt";
import { describeModelFailure } from "@/lib/model-failure";
import type { ModelAsker, ModelRequest } from "@/lib/model-request";
import { canEditMenu } from "@/lib/restaurant-permissions";
import type { SessionContext } from "@/lib/session";
import { pastedMenuSchema } from "@/lib/validation/menu";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// "Read my menu" (step 46): a photo of the menu, a PDF or Word file, or
// pasted text, read into a list of dishes for the owner to check. NOTHING is
// saved here: the list goes back to the page, and only "Looks right"
// (services/menu.ts) adds the dishes, checked again.

export type MenuReadingOutcome =
  | { ok: true; items: ProposedMenuItem[]; dropped: number; standIn: boolean }
  | { ok: false; message: string };

type MenuSource = { file: File | null; text: string | null };

type ReadOptions = {
  // Only the checks replace these: a fake model, and the environment.
  ask?: ModelAsker;
  nodeEnv?: string;
};

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

// Reads the session company's menu from a photo, a file or pasted text into
// a list of dishes, prices in its currency. Owners only.
export async function readMenuForSession(session: SessionContext, source: MenuSource, options: ReadOptions = {}): Promise<MenuReadingOutcome> {
  if (!canEditMenu(session.role)) {
    return refused("Only owners can change the menu.");
  }
  const currency = (await getAssistantSettings(session.companyId))?.currency;
  if (!currency) {
    return refused("Choose your currency in What it knows first: ansa reads the prices in it.");
  }
  const request = await buildRequest(source, currency);
  if ("message" in request) {
    return refused(request.message);
  }
  if (await isOverRateLimit("menu-readings", session.companyId, RATE_LIMITS.menuReadingsPerCompany)) {
    return refused(`Your restaurant has read ${RATE_LIMITS.menuReadingsPerCompany.maxAttempts} menus in the last hour. Try again later, or type the dishes.`);
  }
  let result = await (options.ask ?? askClaudeForMenuReading)(request);
  let standIn = false;
  if (result.kind === "unavailable") {
    if (!menuStandInAllowed(options.nodeEnv ?? process.env.NODE_ENV)) {
      return refused("Reading a menu with the AI isn't available yet. Add your dishes by hand on the Menu page.");
    }
    result = await askStandInForMenuReading(request);
    standIn = true;
  }
  const failure = describeModelFailure(result);
  if (failure) {
    console.error(`Claude call failed: ${failure}`);
  }
  const reading = readMenuReadingAnswer(result, currency);
  if (!reading) {
    return refused("ansa couldn't read this menu. Try again, with a sharper photo, or paste the text.");
  }
  if (reading.items.length === 0) {
    return refused("No dishes with prices were found. Try a sharper photo of the page with the prices, or paste the text.");
  }
  return { ok: true, items: reading.items, dropped: reading.dropped, standIn };
}

// What Claude is sent: the photo itself (its type read from its own first
// bytes), or the text of a file or of what was pasted.
async function buildRequest(source: MenuSource, currency: string): Promise<ModelRequest | { message: string }> {
  const base = { systemPrompt: MENU_READING_SYSTEM_PROMPT, jsonSchema: MENU_READING_JSON_SCHEMA };
  if (source.file && source.file.size > 0) {
    if (source.file.size > MAX_DOCUMENT_BYTES) {
      return { message: TOO_BIG_MESSAGE };
    }
    const bytes = Buffer.from(await source.file.arrayBuffer());
    const imageType = detectMediaType(bytes.subarray(0, SIGNATURE_BYTES));
    const image = IMAGE_TYPES.find((type) => type === imageType);
    if (image) {
      return { ...base, prompt: buildMenuPhotoPrompt(currency), image: { mediaType: image, base64: bytes.toString("base64") } };
    }
    const document = checkDocumentFile(source.file);
    if (!document.ok) {
      return { message: "Upload a photo (JPEG, PNG or WebP), a PDF or a Word file of your menu." };
    }
    const extracted = await extractDocumentText(bytes, document.extension);
    if (!extracted.ok) {
      return { message: "No text could be read from this file (a scanned PDF has none). Upload a photo of the menu instead." };
    }
    return { ...base, prompt: buildMenuTextPrompt(extracted.text, currency) };
  }
  const pasted = pastedMenuSchema.safeParse(source.text ?? "");
  if (!pasted.success) {
    return { message: pasted.error.issues[0]?.message ?? "Paste the text of your menu." };
  }
  if (!pasted.data) {
    return { message: "Upload a photo or a file of your menu, or paste its text." };
  }
  return { ...base, prompt: buildMenuTextPrompt(pasted.data, currency) };
}

function refused(message: string): MenuReadingOutcome {
  return { ok: false, message };
}
