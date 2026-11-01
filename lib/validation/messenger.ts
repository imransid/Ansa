import { z } from "zod";

// Meta's Messenger webhook (step 53), read with only the fields ansa uses
// (everything else is dropped): the Page each entry is for, and each
// message's sender, recipient, id, text, the kind of its first attachment,
// and whether it is an echo of a message the Page sent (with the app that
// sent it). Ids are digits as Meta writes them.
const metaId = z.string().regex(/^\d{1,40}$/);

const messageSchema = z.object({
  mid: z.string().min(1).max(500),
  text: z.string().max(20_000).optional(),
  is_echo: z.boolean().optional(),
  app_id: z.union([z.number().int(), z.string().max(40)]).optional(),
  attachments: z.array(z.object({ type: z.string().max(50) })).max(20).optional(),
});

const messagingSchema = z.object({
  sender: z.object({ id: metaId }),
  recipient: z.object({ id: metaId }),
  message: messageSchema.optional(),
});

export const messengerWebhookSchema = z.object({
  object: z.literal("page"),
  entry: z.array(z.object({ id: metaId, messaging: z.array(messagingSchema).max(100).optional() })).max(100),
});

export type MessengerMessaging = z.infer<typeof messagingSchema>;
