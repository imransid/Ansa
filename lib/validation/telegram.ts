import { z } from "zod";
import { TELEGRAM_MEDIA_KINDS, type TelegramMediaKind } from "@/lib/telegram";

// What ansa reads of Telegram's updates (step 48, the Bot API's Update,
// Message and BusinessConnection objects), and nothing more: every other
// field is dropped by Zod. Ids are whole numbers within JavaScript's safe
// range (Telegram's stay within 52 bits), kept as text. Unknown update
// kinds pass with none of the four fields, and are answered and ignored.

// Telegram's ids: user and chat ids up to 52 bits, negative for groups.
const telegramId = z
  .number()
  .int()
  .refine((value) => Number.isSafeInteger(value))
  .transform((value) => String(value));

const userSchema = z.object({
  id: telegramId,
  is_bot: z.boolean().optional(),
  first_name: z.string().max(1000).optional(),
  last_name: z.string().max(1000).optional(),
  username: z.string().max(100).optional(),
});

const chatSchema = z.object({
  id: telegramId,
  type: z.string().max(40),
  first_name: z.string().max(1000).optional(),
  last_name: z.string().max(1000).optional(),
  username: z.string().max(100).optional(),
});

// Which of Telegram's non-text contents a message holds, by its field's
// presence only: the content itself is never read.
const mediaFields = Object.fromEntries(TELEGRAM_MEDIA_KINDS.map((kind) => [kind, z.unknown().optional()])) as Record<
  TelegramMediaKind,
  z.ZodOptional<z.ZodUnknown>
>;

const messageSchema = z
  .object({
    message_id: z.number().int().nonnegative(),
    chat: chatSchema,
    from: userSchema.optional(),
    text: z.string().max(10_000).optional(),
    caption: z.string().max(10_000).optional(),
    business_connection_id: z.string().min(1).max(200).optional(),
    // Present only on what a bot sent for the business account: ansa's own replies.
    sender_business_bot: z.unknown().optional(),
    ...mediaFields,
  })
  .transform(({ message_id, chat, from, text, caption, business_connection_id, sender_business_bot, ...media }) => ({
    messageId: String(message_id),
    chat,
    from,
    text,
    caption,
    businessConnectionId: business_connection_id,
    sentByBot: sender_business_bot !== undefined,
    mediaKind: TELEGRAM_MEDIA_KINDS.find((kind) => media[kind] !== undefined) ?? null,
  }));

const businessConnectionSchema = z.object({
  id: z.string().min(1).max(200),
  user: userSchema,
  user_chat_id: telegramId,
  rights: z.object({ can_reply: z.boolean().optional() }).optional(),
  is_enabled: z.boolean(),
});

const deletedMessagesSchema = z.object({
  business_connection_id: z.string().min(1).max(200),
  chat: chatSchema,
  message_ids: z.array(z.number().int().nonnegative()).max(1000),
});

export const telegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: messageSchema.optional(),
  business_connection: businessConnectionSchema.optional(),
  business_message: messageSchema.optional(),
  deleted_business_messages: deletedMessagesSchema.optional(),
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
export type TelegramMessage = z.infer<typeof messageSchema>;
export type TelegramBusinessConnection = z.infer<typeof businessConnectionSchema>;
export type TelegramDeletedMessages = z.infer<typeof deletedMessagesSchema>;

// The Bot API's answers ansa reads: ok, the sent message's id, the error's
// number and how long to wait. Telegram's own description is never read.
export const telegramSendAnswerSchema = z.object({
  ok: z.boolean(),
  result: z.object({ message_id: z.number().int() }).optional(),
  error_code: z.number().int().optional(),
});

export const telegramUpdatesAnswerSchema = z.object({
  ok: z.boolean(),
  result: z.array(z.unknown()).optional(),
  error_code: z.number().int().optional(),
});

export const telegramOkAnswerSchema = z.object({ ok: z.boolean(), error_code: z.number().int().optional() });
