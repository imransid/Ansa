// Settings → Connections checks (the fixes of 2026-11-03), on the code
// itself, as ui-polish-checks.ts does: the social account buttons there
// bring the owner back there and offer a stand-in only while none is
// connected; a Facebook Page has its own Disconnect there; a stand-in is
// marked once and its advice links the practice chat; each chat channel
// says what ansa does when the business answers in its own app; and the
// practice chat can answer as the business.

import assert from "node:assert/strict";
import { check } from "./check";
import { attributeValue, openingTags, read, withoutComments } from "./source-helpers";

const FOLDER = "app/settings/channels";
const MESSENGER = `${FOLDER}/messenger-from-core.tsx`;
const POSTING = "components/channels/more-connections.tsx";
const CHAT_SECTIONS = [`${FOLDER}/whatsapp-section.tsx`, `${FOLDER}/telegram-section.tsx`, MESSENGER];

export async function runConnectionsChecks() {
  await check("connections: its social account buttons (a stand-in Page, LinkedIn, X, YouTube, a Page's Disconnect) name their page, so the owner comes back to Settings → Connections; a stand-in is offered only while none is connected", async () => {
    for (const file of [MESSENGER, POSTING]) {
      const source = withoutComments(await read(file));
      const buttons = openingTags(source, ["ActionButton", "ConfirmButton"]).filter((tag) => /connectStandInAccountAction|disconnectSocialAccountAction/.test(tag));
      assert.ok(buttons.length > 0, `${file}: no stand-in or Disconnect button`);
      for (const tag of buttons) {
        assert.match(attributeValue(tag, "fields") ?? "", /from: "connections"/, `${file}: a button that doesn't name its page`);
      }
    }
    assert.match(withoutComments(await read(POSTING)), /platform\.mode === "stand-in" && live\.length === 0 && \(\s*<ActionButton\s+action=\{connectStandInAccountAction\}/);
    assert.match(withoutComments(await read(MESSENGER)), /messenger\.pages\.length === 0 && \(\s*<ActionButton\s+action=\{connectStandInAccountAction\}/);
  });

  await check("connections: a Facebook Page has its own Disconnect there, for owners, asking first", async () => {
    const source = withoutComments(await read(MESSENGER));
    assert.match(source, /\{canManage && \(\s*<ConfirmButton\s+action=\{disconnectSocialAccountAction\}\s+fields=\{\{ connectionId: page\.id, from: "connections" \}\}/);
  });

  await check("connections: a stand-in is marked once (one Development stand-in tag), and its advice links the practice chat instead of a make command", async () => {
    for (const file of CHAT_SECTIONS) {
      const source = withoutComments(await read(file));
      assert.doesNotMatch(source, /\(development stand-in\)|, a development stand-in|make simulate/, `${file} marks a stand-in twice, or names a make command`);
      assert.match(source, /<StandInName /, `${file} doesn't mark its stand-in`);
      assert.match(source, /<PracticeChatAdvice /, `${file} doesn't link the practice chat`);
    }
    const standIn = withoutComments(await read(`${FOLDER}/stand-in.tsx`));
    assert.match(standIn, /<Badge variant="outline">Development stand-in<\/Badge>/);
    assert.match(standIn, /href="\/settings\/channels\/practice-chat"/);
  });

  await check("connections: each chat channel says what ansa does when the business answers in its own app, with Always and with Only when I'm away", async () => {
    for (const file of CHAT_SECTIONS) {
      assert.match(withoutComments(await read(file)), /<OwnAnswersNote app=/, `${file} doesn't say it`);
    }
    const note = withoutComments(await read(`${FOLDER}/own-answers.tsx`));
    for (const words of ["Always", "Only when I&apos;m away", "Hand back to ansa"]) {
      assert.ok(note.includes(words), `the note doesn't name ${words}`);
    }
    assert.doesNotMatch(withoutComments(await read(`${FOLDER}/whatsapp-section.tsx`)), /stays quiet\./, "WhatsApp promises ansa always stays quiet");
  });

  await check("connections: setting names and developer folders (.env.core, .dev-messages/) sit only in a closed \"For developers\" fold, the stand-in WhatsApp number shows as \"Practice number\", and Telegram's and WhatsApp's Disconnect keep a button's own width", async () => {
    for (const file of [`${FOLDER}/stand-in.tsx`, `${FOLDER}/telegram-section.tsx`, `${FOLDER}/whatsapp-section.tsx`]) {
      const shown = withoutComments(await read(file))
        .replace(/<ForDevelopers>[\s\S]*?<\/ForDevelopers>/g, "")
        .replace(/export function ForDevelopers[\s\S]*?\n\}\n/, "");
      assert.doesNotMatch(shown, /\.env\.core|\.dev-messages|[A-Z]+_[A-Z_]*(TOKEN|SECRET|ID|USERNAME)\b/, `${file} shows developer words outside its fold`);
    }
    const standIn = withoutComments(await read(`${FOLDER}/stand-in.tsx`));
    assert.match(standIn, /<details className="[^"]*">\s*<summary[^>]*>For developers<\/summary>/);
    const whatsapp = withoutComments(await read(`${FOLDER}/whatsapp-section.tsx`));
    assert.match(whatsapp, /<StandInName name="Practice number" \/>/);
    for (const file of [`${FOLDER}/whatsapp-section.tsx`, `${FOLDER}/telegram-section.tsx`]) {
      assert.match(withoutComments(await read(file)), /<div className="justify-self-start">\s*<ConfirmButton/, `${file}'s Disconnect fills the card's width`);
    }
  });

  await check("one person's pages (step 50) speak to a person, a business's keep their words: Connections' notes (someone writing to you, answering as yourself, no marketing accounts link), Saved answers, About you and Account", async () => {
    for (const file of CHAT_SECTIONS) {
      const source = withoutComments(await read(file));
      for (const tag of openingTags(source, ["PracticeChatAdvice", "OwnAnswersNote"])) {
        assert.equal(attributeValue(tag, "personal"), "{personal}", `${file}: ${tag} isn't told whose account it is`);
      }
    }
    assert.match(withoutComments(await read(`${FOLDER}/stand-in.tsx`)), /personal \? "someone writing to you" : "a customer"/);
    assert.match(withoutComments(await read(`${FOLDER}/own-answers.tsx`)), /\{personal \? "someone" : "a customer"\}/);
    assert.match(withoutComments(await read(MESSENGER)), /\{!personal && \(\n\s*<Link href="\/cofounder\/accounts"/);
    assert.match(withoutComments(await read("app/knowledge/page.tsx")), /\{personal \? "Saved answers" : "Knowledge"\}/);
    assert.match(withoutComments(await read("app/knowledge/test-search-box.tsx")), /personal \? "A question someone might ask you" : "A question a customer might ask"/);
    assert.match(withoutComments(await read("app/settings/business/page.tsx")), /\{profile\.kind === "personal" \? "About you" : "What it knows"\}/);
    assert.match(withoutComments(await read("app/account/page.tsx")), /kind === "personal" \?/);
  });

  await check("practice chat: the owner may answer as the business, from its own app (a tick), and the page sends that choice to core", async () => {
    const form = withoutComments(await read(`${FOLDER}/practice-chat/message-form.tsx`));
    assert.match(form, /<Checkbox\s+checked=\{asBusiness\}/);
    assert.match(form, /Answer as the business, from its own app/);
    assert.match(withoutComments(await read(`${FOLDER}/practice-chat/practice-chat.tsx`)), /sendPracticeMessageAction\(\{ channel, name, text: message, asBusiness \}\)/);
    assert.match(withoutComments(await read("app/actions/practice-chat.ts")), /asBusiness: z\.boolean\(\)/);
    assert.match(withoutComments(await read("lib/core-views/practice-chat.ts")), /\{ channel, name, text, asBusiness \}/);
  });

  await check("practice chat: the next look at the chat starts only once the one before ended, none starts while a message is being sent, and a send never waits for an extra read (server actions run one at a time)", async () => {
    const page = withoutComments(await read(`${FOLDER}/practice-chat/practice-chat.tsx`));
    assert.doesNotMatch(page, /setInterval/);
    assert.match(page, /if \(!stopped\) \{\s*timer = setTimeout\(look, LOOK_EVERY_MS\);/);
    assert.match(page, /if \(!sending\.current\) \{/);
    const send = page.slice(page.indexOf("function send("), page.indexOf("async function showChatIfThere"));
    assert.ok(send.includes("sendPracticeMessageAction") && !send.includes("readPracticeChatAction"), "the send reads the chat again");
  });

  await check("practice chat: 'ansa is writing...' shows only while core says ansa answers the newest message; otherwise a line for the presenter says why it doesn't", async () => {
    const window = withoutComments(await read(`${FOLDER}/practice-chat/chat-window.tsx`));
    assert.match(window, /const typing = waitsForAnsa && next\.what === "answers"/);
    assert.match(window, /<QuietNote next=\{next\} personal=\{personal\} \/>/);
    assert.match(withoutComments(await read("lib/core-views/practice-chat.ts")), /export type PracticeChatRead = \{ lines: PracticeLine\[\]; next: PracticeNext \}/);
  });

  await check("practice chat: for one person it speaks of who writes and answering as yourself, never of a customer or a business", async () => {
    const form = withoutComments(await read(`${FOLDER}/practice-chat/message-form.tsx`));
    assert.match(form, /tick: "Answer as yourself, from your own app"/);
    const personalWords = form.slice(form.indexOf("personal: {"), form.indexOf("};", form.indexOf("personal: {")));
    assert.doesNotMatch(personalWords, /customer|business/i);
    const who = withoutComments(await read(`${FOLDER}/practice-chat/who-writes.tsx`));
    assert.match(who, /personal \? "Who writes, and on which app" : "The customer writes on"/);
    assert.match(who, /personal \? "Their name" : "Customer's name"/);
  });
}
