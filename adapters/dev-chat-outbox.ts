import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Not a real channel: the development stand-in chat (step 47), until Telegram
// (step 48) and Messenger (step 53). Each reply a person sends to a stand-in
// customer becomes a JSON file in .dev-messages/ (git-ignored), named after
// the message. Nothing is sent anywhere.
export const STAND_IN_OUTBOX_DIR = path.join(process.cwd(), ".dev-messages");

export async function writeStandInChatMessage(message: { id: string; to: string; text: string }): Promise<void> {
  await mkdir(STAND_IN_OUTBOX_DIR, { recursive: true });
  const fileName = `${new Date().toISOString().replaceAll(":", "-")}-${message.id}.json`;
  const content = { note: "Stand-in chat: this message was NOT sent.", to: message.to, text: message.text };
  await writeFile(path.join(STAND_IN_OUTBOX_DIR, fileName), `${JSON.stringify(content, null, 2)}\n`);
}
