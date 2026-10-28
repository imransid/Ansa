// Step 27, what is kept of a received email: an HTML-only email keeps text
// made from its HTML (and Claude reads it; an HTML part with no text says so),
// attachments are counted and named (names encrypted, company-only) apart
// from the images the HTML shows inside the email, subjects and bodies are
// capped, and the sender's name comes from headers.from when Resend gives a
// bare from. FAKE fetcher and model only.

import assert from "node:assert/strict";
import { htmlToPlainText } from "@/lib/html-to-text";
import { getOriginalEmailForSession } from "@/services/inbound-emails";
import { answer } from "./brain-guard-checks";
import { fakeModel } from "./brain-test-calls";
import { check, runId, sessionFor, signUpTestOwner, type TestUser } from "./helpers";
import { receiveAndProcess, resendContent, senderFor } from "./inbound-helpers";

export async function runInboundContentChecks(ownerB: TestUser) {
  const owner = await signUpTestOwner("content");

  await check("inbound content: an HTML-only email keeps text made from its HTML (no tags, styles, scripts or inline images); Claude reads it too", async () => {
    const html = [
      `<html><head><style>.x{color:red}</style><script>alert("${runId}")</script></head><body>`,
      "<p>Hello &amp; thanks,</p><p>The screen is <b>cracked</b>.<br>Order 42.</p>",
      `<img src="data:image/png;base64,${"A".repeat(5_000)}"><!-- hidden-${runId} --></body></html>`,
    ].join("");
    const model = fakeModel(answer({ customer_issue: "Cracked screen.", ticket_subject: "Cracked screen", category: "" }));
    const { outcome, row, ticket } = await receiveAndProcess(owner, "html-only", resendContent("html-only", { text: null, html }), model.ask);
    assert.equal(outcome, "ticketed");
    assert.equal(row.bodyFromHtml, true);
    const original = await getOriginalEmailForSession(sessionFor(owner), ticket!.id);
    assert.equal(original?.body, "Hello & thanks,\n\nThe screen is cracked.\nOrder 42.");
    assert.equal(original?.bodyFromHtml, true);
    for (const hidden of ["<", "alert", "color:red", "AAAA", `hidden-${runId}`]) {
      assert.ok(!original?.body?.includes(hidden), `kept: ${hidden}`);
    }
    assert.ok(model.prompts[0].includes("The screen is cracked."), "Claude did not see the email's text");
  });

  await check("inbound content: attachments are counted and named on the ticket (names encrypted, company-only), images shown inside the email counted apart", async () => {
    const html = `<p>Hi</p><img src="cid:logo-${runId}@01D9"><img src="CID:Pasted-${runId}">`;
    const attachments = [
      { filename: `invoice-${runId}.pdf` },
      { filename: "photo\u202Egpj.exe" },
      { filename: null },
      // A signature logo and a pasted picture: the HTML shows them ("cid:").
      { filename: "image001.png", content_id: `<logo-${runId}@01D9>` },
      { filename: "image002.png", content_id: `pasted-${runId}` },
      // A content id the HTML never shows: a file the customer attached.
      { filename: "report.pdf", content_id: "<not-shown@mail.test>" },
    ];
    const { row, ticket } = await receiveAndProcess(owner, "attachments", resendContent("attachments", { html, attachments }));
    assert.deepEqual([row.attachmentCount, row.inlineImageCount], [4, 2]);
    assert.ok(row.attachmentNamesEncrypted?.startsWith("v1:") && !row.attachmentNamesEncrypted.includes("invoice"), "names stored in plain text");
    const original = await getOriginalEmailForSession(sessionFor(owner), ticket!.id);
    assert.deepEqual(
      [original?.attachmentCount, original?.attachmentNames, original?.inlineImageCount],
      [4, [`invoice-${runId}.pdf`, "photogpj.exe", "report.pdf"], 2],
    );
    assert.equal(await getOriginalEmailForSession(sessionFor(ownerB), ticket!.id), null);
  });

  await check("inbound content: an HTML part with no text is marked as such (never shown as an empty email)", async () => {
    const html = `<html><body><img src="cid:photo-${runId}"></body></html>`;
    const onlyPicture = resendContent("html-no-text", { text: null, html, attachments: [{ filename: "photo.jpg", content_id: `<photo-${runId}>` }] });
    const { outcome, ticket } = await receiveAndProcess(owner, "html-no-text", onlyPicture);
    assert.equal(outcome, "ticketed");
    const original = await getOriginalEmailForSession(sessionFor(owner), ticket!.id);
    assert.deepEqual([original?.body, original?.bodyFromHtml, original?.inlineImageCount, original?.attachmentCount], [null, true, 1, 0]);
  });

  await check("inbound content: subject and body are capped, and the cut is marked", async () => {
    const huge = resendContent("huge", { subject: "S".repeat(5_000), text: "B".repeat(150_000) });
    const { ticket } = await receiveAndProcess(owner, "huge", huge);
    const original = await getOriginalEmailForSession(sessionFor(owner), ticket!.id);
    assert.equal(original?.subject?.length, 1_000);
    const body = original?.body ?? "";
    assert.ok(body.startsWith("B".repeat(100_000)) && body.endsWith("longer than 100,000 characters.]"), "the cut is not marked");
    assert.ok(body.length < 100_200, `kept ${body.length} characters`);
  });

  await check("inbound content: HTML to text decodes entities, keeps lines and table cells, reads a document without </head>; hostile HTML stays fast", async () => {
    const listed = htmlToPlainText("<div>Price: &lt;10&gt; &#8364;5 &#x41;&nbsp;B &bogus;</div><ul><li>One</li><li>Two</li></ul>", 1_000);
    assert.equal(listed, "Price: <10> €5 A B &bogus;\n\nOne\n\nTwo");
    assert.equal(htmlToPlainText("Hi <unclosed and the rest", 1_000), "Hi");
    assert.equal(htmlToPlainText("<STYLE>p{}</STYLE>Shown<Script>x</sCrIpT> too", 1_000), "Shown too");
    // </head> is optional in HTML, and minifiers leave it out.
    assert.equal(htmlToPlainText('<html><head><meta charset="utf-8"><body><p>Hello, my order is late</p></body></html>', 1_000), "Hello, my order is late");
    const form = "<table><tr><th>Email</th> <td>ana@example.com</td></tr><tr><td>Name</td><td>Ana  Lima</td></tr></table>";
    assert.equal(htmlToPlainText(form, 1_000), "Email\tana@example.com\n\nName\tAna Lima");
    assert.equal(htmlToPlainText("<dl><dt>Order</dt><dd>42</dd></dl><p>caf&eacute; &Eacute;t&eacute; &rsquo;&hellip;&mdash; &frac12;</p>", 1_000), "Order\n\n42\n\ncafé Été ’…— ½");
    const spaces = "<span> </span>".repeat(50_000);
    const hostile = spaces + "<style>x</style>".repeat(20_000) + "<p>a</p>".repeat(20_000) + "<!-- c -->".repeat(20_000) + "<script>";
    const startedAt = Date.now();
    const text = htmlToPlainText(hostile, 100_000);
    assert.ok(Date.now() - startedAt < 2_000, `took ${Date.now() - startedAt} ms`);
    assert.ok(text.startsWith("a\n\na"));
  });

  await check("inbound content: the name comes from headers.from when Resend gives a bare from; a header naming another address is not trusted", async () => {
    const plain = await receiveAndProcess(owner, "header-name", resendContent("header-name"));
    assert.deepEqual([plain.ticket?.customerName, plain.ticket?.customerEmail], ["Kim Lee", senderFor("header-name")]);
    const otherAddress = resendContent("header-other", { headers: { from: `Kim Lee <someone-else-${runId}@customer.test>` } });
    const mismatch = await receiveAndProcess(owner, "header-other", otherAddress);
    assert.deepEqual([mismatch.outcome, mismatch.ticket?.customerName, mismatch.ticket?.customerEmail], ["ticketed", null, null]);
    assert.equal(mismatch.row.senderVerified, false);
    // The same address written two ways (ASCII and international domain) agrees.
    const twoSpellings = resendContent("header-idn", { from: `ivan-${runId}@xn--80a1acny.xn--p1ai`, headers: { from: `Ivan <Ivan-${runId}@почта.рф>` } });
    const idn = await receiveAndProcess(owner, "header-idn", twoSpellings);
    assert.deepEqual([idn.ticket?.customerName, idn.ticket?.customerEmail], ["Ivan", `ivan-${runId}@xn--80a1acny.xn--p1ai`]);
  });
}
