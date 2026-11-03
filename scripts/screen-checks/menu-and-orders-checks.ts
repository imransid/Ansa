// The menu and Orders pages, on the code itself and on the pure lib files
// the browser runs: prices read as core reads them (the same cases), Read
// my menu offers the files core reads and says when a Word file was cut, a
// change the customer wasn't told about stays on the Orders page in words
// for its channel, the page says when the package has no orders, and the
// orders form keeps its ticks when a save is refused.

import assert from "node:assert/strict";
import { parsePrice } from "@/lib/menu";
import { orderNotToldText } from "@/lib/order-notices";
import { orderStatusLabel } from "@/lib/orders";
import { ordersPageNoticeSchema } from "@/lib/validation/orders";
import { check } from "./check";
import { attributeValue, openingTags, read, withoutComments } from "./source-helpers";

type PriceVectors = { cases: { text: string; currency: string; cents: number | null }[] };

export async function runMenuAndOrdersChecks() {
  await check("prices: the screens' parsePrice reads every case core's money.ParsePrice is tested with (core/internal/money/testdata/prices.json)", async () => {
    const vectors = JSON.parse(await read("core/internal/money/testdata/prices.json")) as PriceVectors;
    assert.ok(vectors.cases.length > 20, "the vectors are empty");
    for (const { text, currency, cents } of vectors.cases) {
      assert.equal(parsePrice(text, currency), cents, `${JSON.stringify(text)} in ${currency}`);
    }
  });

  await check("Read my menu: the file picker offers what core reads (JPEG, PNG, WebP, GIF, PDF, Word) and nothing it refuses, and a Word file's text cut to 20,000 characters is said", async () => {
    const reader = withoutComments(await read("components/menu/menu-reader.tsx"));
    const [picker] = openingTags(reader, ["Input"]).filter((tag) => attributeValue(tag, "id") === '"menu-file"');
    assert.equal(attributeValue(picker, "accept"), '"image/jpeg,image/png,image/webp,image/gif,.pdf,.docx"');
    assert.match(reader, /\{notes\.textCut && /);
    assert.match(withoutComments(await read("lib/core-views/menu.ts")), /textCut: answer\.data\.textCut/);
  });

  await check("Orders: why a customer wasn't told is worded for their channel (a WhatsApp or Messenger chat is no Telegram one)", async () => {
    assert.match(orderNotToldText("window-closed", "whatsapp"), /WhatsApp lets ansa write only within 24 hours/);
    assert.match(orderNotToldText("not-connected", "messenger"), /Facebook Page isn't connected/);
    assert.match(orderNotToldText("cannot-reply", "telegram"), /Telegram Business → Chatbots/);
    assert.match(orderNotToldText("not-chat", "phone"), /ordered on a call/);
    for (const channel of ["whatsapp", "messenger", "phone"] as const) {
      for (const reason of ["window-closed", "not-connected", "cannot-reply", "not-chat", "not-found", "send-failed"] as const) {
        assert.doesNotMatch(orderNotToldText(reason, channel), /Telegram/, `${reason} on ${channel}`);
      }
    }
    // Only known codes from the address show anything, never its own text.
    assert.equal(ordersPageNoticeSchema.safeParse({ notTold: "window-closed", channel: "whatsapp", order: "12" }).success, true);
    assert.equal(ordersPageNoticeSchema.safeParse({ notTold: "<b>hi</b>", channel: "whatsapp", order: "12" }).success, false);
  });

  await check("Orders: a change the customer wasn't told about stays on the page after the order moved on (its button is gone): the action sends it in the page's address", async () => {
    const action = withoutComments(await read("app/actions/orders.ts"));
    assert.match(action, /redirect\(ordersPageAddress\(changed\.notTold\), RedirectType\.replace\)/);
    const page = withoutComments(await read("app/orders/page.tsx"));
    assert.match(page, /ordersPageNoticeSchema\.safeParse\(/);
    assert.match(page, /<NotToldNotice /);
    assert.match(withoutComments(await read("app/orders/not-told-notice.tsx")), /orderNotToldText\(reason, channel\)/);
  });

  await check("Orders: the page says when the package doesn't include orders, and the cancel question promises a message only when the chat allows it", async () => {
    const page = withoutComments(await read("app/orders/page.tsx"));
    assert.match(page, /\{!packageIncludesOrders && \(/);
    assert.match(page, /Your package doesn&apos;t include orders: customers&apos; orders go to you as requests/);
    const card = withoutComments(await read("app/orders/order-card.tsx"));
    assert.match(card, /The customer gets a message when their chat allows it\./);
    assert.doesNotMatch(card, /The customer gets a message that it was cancelled\./);
  });

  await check("Orders: a ready order's status says what its button said (On its way for a delivery, Ready to pick up for a pickup), on the Orders page and the conversation page; the question that cancels keeps the order with \"Keep it\", never a second \"Cancel\"", async () => {
    assert.equal(orderStatusLabel("ready", "delivery"), "On its way");
    assert.equal(orderStatusLabel("ready", "pickup"), "Ready to pick up");
    assert.equal(orderStatusLabel("accepted", "delivery"), "Accepted");
    const card = withoutComments(await read("app/orders/order-card.tsx"));
    assert.match(card, /label=\{order\.fulfilment === "delivery" \? "On its way" : "Ready to pick up"\}/, "the button's words changed: change orderStatusLabel with them");
    for (const file of ["app/orders/order-card.tsx", "app/inbox/[conversationId]/page.tsx"]) {
      const source = withoutComments(await read(file));
      assert.match(source, /orderStatusLabel\(order\.status, order\.fulfilment\)/, `${file} shows a status without its fulfilment`);
      assert.doesNotMatch(source, /ORDER_STATUS_LABELS\[/, `${file} shows "Ready" for an order on its way`);
    }
    const [cancel] = openingTags(card, ["ConfirmButton"]);
    assert.equal(attributeValue(cancel, "dismissLabel"), '"Keep it"');
  });

  await check("orders form: a save refused (no delivery or pickup) keeps the boxes as they were ticked", async () => {
    assert.match(withoutComments(await read("app/actions/restaurant-setup.ts")), /saveSection\("orders", formData, \["takesOrders", "delivery", "pickup", /);
    const form = withoutComments(await read("components/restaurant-setup/orders-form.tsx"));
    for (const name of ["takesOrders", "delivery", "pickup"]) {
      const [box] = openingTags(form, ["CheckField"]).filter((tag) => attributeValue(tag, "name") === `"${name}"`);
      assert.equal(attributeValue(box, "defaultChecked"), `{ticked("${name}", props.${name})}`, name);
    }
  });
}
