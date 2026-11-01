import "server-only";
import { z } from "zod";
import type { ChatDeliveryResult } from "@/lib/chat-delivery";
import { API_TIMEOUT_MS, discardAnswer, formRequest, readJsonAnswer, sendToPlatform } from "@/lib/social-http";
import type { SocialFetch } from "@/lib/social-types";
import { appSecretProof, GRAPH_URL, graphErrorSchema, THROTTLED_CODES } from "./facebook-graph";

// Facebook Messenger (step 53): the ONLY file that talks to Meta's
// Messenger Platform, with a Facebook Page's token (step 40's connection).
// A reply to a customer (Send API, messaging_type RESPONSE: only within 24
// hours of their message), switching a Page's messages on for ansa's app,
// and a customer's name. Only the fields used are read; Meta's words never
// are, and nothing here logs (the token is in every address).

export type MessengerContext = { fetchFn: SocialFetch; appSecret: string };

// Meta's longest text message; a longer one goes as several, cut at a line
// break or a space.
export const MESSENGER_TEXT_MAX = 2_000;

// The error code and subcode Meta answers a message outside the 24 hours with.
const OUTSIDE_WINDOW = { code: 10, subcode: 2018278 };
const INVALID_TOKEN_CODE = 190;

const sentSchema = z.object({ message_id: z.string().min(1).max(500) });

export async function sendMessengerMessage(
  context: MessengerContext,
  message: { pageId: string; pageToken: string; psid: string; text: string },
): Promise<ChatDeliveryResult> {
  let firstId: string | null = null;
  for (const [index, part] of splitText(message.text).entries()) {
    const result = await sendOnePart(context, { ...message, text: part });
    if (result.status !== "sent") {
      // A part after the first one went out: the customer has some of it.
      return index === 0 ? result : { status: "unclear", error: "no_answer" };
    }
    firstId ??= result.channelMessageId;
  }
  return { status: "sent", channelMessageId: firstId };
}

async function sendOnePart(context: MessengerContext, message: { pageId: string; pageToken: string; psid: string; text: string }): Promise<ChatDeliveryResult> {
  const query = new URLSearchParams({ access_token: message.pageToken, appsecret_proof: appSecretProof(message.pageToken, context.appSecret) });
  const body = JSON.stringify({ recipient: { id: message.psid }, messaging_type: "RESPONSE", message: { text: message.text } });
  const answer = await sendToPlatform(
    context.fetchFn,
    `${GRAPH_URL}/${encodeURIComponent(message.pageId)}/messages?${query}`,
    { method: "POST", headers: { "content-type": "application/json" }, body },
    API_TIMEOUT_MS,
  );
  if (answer.kind === "no_answer") {
    return { status: "unclear", error: "no_answer" };
  }
  const { response } = answer;
  if (response.ok) {
    const sent = await readJsonAnswer(response, sentSchema);
    return sent ? { status: "sent", channelMessageId: sent.message_id } : { status: "unclear", error: "no_answer" };
  }
  if (response.status >= 500) {
    await discardAnswer(response);
    return { status: "unclear", error: "no_answer" };
  }
  const error = (await readJsonAnswer(response, graphErrorSchema))?.error;
  if (error && error.code === OUTSIDE_WINDOW.code && error.error_subcode === OUTSIDE_WINDOW.subcode) {
    return { status: "failed", error: "reply_window_closed" };
  }
  if (error && THROTTLED_CODES.includes(error.code)) {
    return { status: "failed", error: "rate_limited" };
  }
  return { status: "failed", error: error?.code === INVALID_TOKEN_CODE ? "not_connected" : "refused" };
}

// Switches the Page's messages on for ansa's app (subscribed_apps), so Meta
// sends them to ansa's webhook. True when Meta says it worked.
export async function subscribePageToMessages(context: MessengerContext, page: { pageId: string; pageToken: string }): Promise<boolean> {
  const params = {
    subscribed_fields: "messages,message_echoes",
    access_token: page.pageToken,
    appsecret_proof: appSecretProof(page.pageToken, context.appSecret),
  };
  const answer = await sendToPlatform(context.fetchFn, `${GRAPH_URL}/${encodeURIComponent(page.pageId)}/subscribed_apps`, formRequest(params), API_TIMEOUT_MS);
  if (answer.kind === "no_answer") {
    return false;
  }
  if (!answer.response.ok) {
    await discardAnswer(answer.response);
    return false;
  }
  return (await readJsonAnswer(answer.response, z.object({ success: z.literal(true) }))) !== null;
}

// The customer's first and last name as Meta gives them to the Page, or null.
export async function getMessengerName(context: MessengerContext, person: { psid: string; pageToken: string }): Promise<string | null> {
  const query = new URLSearchParams({ fields: "first_name,last_name", access_token: person.pageToken, appsecret_proof: appSecretProof(person.pageToken, context.appSecret) });
  const answer = await sendToPlatform(context.fetchFn, `${GRAPH_URL}/${encodeURIComponent(person.psid)}?${query}`, { method: "GET" }, API_TIMEOUT_MS);
  if (answer.kind === "no_answer") {
    return null;
  }
  if (!answer.response.ok) {
    await discardAnswer(answer.response);
    return null;
  }
  const names = await readJsonAnswer(answer.response, z.object({ first_name: z.string().max(200).optional(), last_name: z.string().max(200).optional() }));
  const name = [names?.first_name, names?.last_name].filter(Boolean).join(" ").trim();
  return name || null;
}

// Parts of at most MESSENGER_TEXT_MAX characters, each cut after a line
// break or a space when there is one in its second half.
export function splitText(text: string): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > MESSENGER_TEXT_MAX) {
    const window = rest.slice(0, MESSENGER_TEXT_MAX);
    const cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const at = cut > MESSENGER_TEXT_MAX / 2 ? cut + 1 : MESSENGER_TEXT_MAX;
    parts.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at);
  }
  parts.push(rest);
  return parts.filter((part) => part !== "");
}
