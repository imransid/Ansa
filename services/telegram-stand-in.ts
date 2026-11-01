import "server-only";
import { createHash, randomInt } from "node:crypto";
import { findStandInTelegramConnection } from "@/db/channel-connections";
import { telegramStandInsAllowed } from "@/lib/telegram-mode";
import { telegramUpdateSchema } from "@/lib/validation/telegram";
import { handleTelegramUpdate, type AnswerCustomer } from "./telegram-updates";

// A customer's Telegram message to a company's stand-in Telegram account
// (step 48, development only: pnpm simulate:telegram), built as Telegram
// would send it and handled by the same code as a real one, from reading
// the update on. Replies to that customer are written to .dev-messages/.

export type StandInTelegramOutcome = "saved" | "no-stand-in" | "not-allowed";

// Saves the message; `answer` gets where it was saved (the script lets the assistant answer it).
export async function receiveStandInTelegramMessage(
  companyId: string,
  customerName: string,
  text: string,
  answer: AnswerCustomer = () => undefined,
): Promise<StandInTelegramOutcome> {
  if (!telegramStandInsAllowed()) {
    return "not-allowed";
  }
  const connectionId = await findStandInTelegramConnection(companyId);
  if (!connectionId) {
    return "no-stand-in";
  }
  const customerId = standInCustomerId(customerName);
  const update = telegramUpdateSchema.parse({
    update_id: randomInt(1, 2 ** 31),
    business_message: {
      message_id: randomInt(1, 2 ** 31),
      business_connection_id: connectionId,
      chat: { id: customerId, type: "private", first_name: customerName },
      from: { id: customerId, is_bot: false, first_name: customerName },
      text,
    },
  });
  await handleTelegramUpdate(update, () => undefined, answer);
  return "saved";
}

// The same name is the same made-up Telegram customer (a whole number from
// the name's hash, as Telegram's user ids are).
function standInCustomerId(name: string): number {
  return createHash("sha256").update(name.trim().toLowerCase(), "utf8").digest().readUIntBE(0, 6);
}
