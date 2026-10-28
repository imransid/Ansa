// Safe fetch checks (step 34, "Import a web page"): lib/safe-fetch.ts refuses
// http, other ports, credentials in the address, and every address of this
// machine or a private network, whether typed or resolved, and checks every
// redirect again; it stops at 2 MB, 10 seconds (and opens nothing after
// them, even when a DNS answer comes later), and anything but HTML or plain
// text; and a public page is fetched from exactly the address that was
// checked, with no cookie or credentials. FAKE resolver and fake server only
// (safe-fetch-fakes.ts): nothing here touches the network ("localhost"
// resolves from the hosts file).

import assert from "node:assert/strict";
import type { LookupAddress, LookupOptions } from "node:dns";
import { isPublicAddress } from "@/lib/public-address";
import { safeFetchText } from "@/lib/safe-fetch";
import { check } from "./helpers";
import { fakeResolver, fakeServer, page, PUBLIC_V4, PUBLIC_V6, type FakeAnswer } from "./safe-fetch-fakes";

export async function runKnowledgeFetchChecks() {
  await check("safe fetch: http, another port, a user name or password, and addresses of this machine or a private network are refused before any request", async () => {
    const server = fakeServer({});
    const refusals: [string, string][] = [
      ["http://example.com/", "not_https"],
      ["ftp://example.com/", "not_https"],
      ["https://example.com:8443/", "port_not_allowed"],
      ["https://user:secret@example.com/", "credentials_in_url"],
      ["not a url", "invalid_url"],
      ["https://127.0.0.1/", "private_address"],
      ["https://[::1]/", "private_address"],
      ["https://10.1.2.3/", "private_address"],
      ["https://169.254.169.254/latest/meta-data/", "private_address"],
      ["https://[::ffff:127.0.0.1]/", "private_address"],
      ["https://0.0.0.0/", "private_address"],
      ["https://192.168.1.1/admin", "private_address"],
    ];
    for (const [url, code] of refusals) {
      assert.deepEqual(await safeFetchText(url, { request: server.request, resolve: fakeResolver({}) }), { ok: false, code }, url);
    }
    // The real resolver: "localhost" is this machine.
    assert.deepEqual(await safeFetchText("https://localhost/", { request: server.request }), { ok: false, code: "private_address" });
    assert.equal(server.requests.length, 0, "a request was made");
  });

  await check("safe fetch: a host name that resolves to a private address, or to one among public ones, is refused", async () => {
    const server = fakeServer({});
    const resolve = fakeResolver({
      "internal.example.test": ["10.0.0.5"],
      "mixed.example.test": [PUBLIC_V4, "fd00::1"],
      "metadata.example.test": ["169.254.169.254"],
      "mapped.example.test": ["::ffff:192.168.0.1"],
    });
    for (const host of ["internal.example.test", "mixed.example.test", "metadata.example.test", "mapped.example.test"]) {
      assert.deepEqual(await safeFetchText(`https://${host}/`, { request: server.request, resolve }), { ok: false, code: "private_address" }, host);
    }
    assert.deepEqual(await safeFetchText("https://nowhere.example.test/", { request: server.request, resolve }), { ok: false, code: "dns_failed" });
    assert.equal(server.requests.length, 0, "a request was made");
  });

  await check("safe fetch: every redirect is checked again (a private address, http, more than 3, no Location)", async () => {
    const resolve = fakeResolver({ "public.example.test": [PUBLIC_V4], "internal.example.test": ["10.0.0.5"] });
    const redirect = (location?: string): FakeAnswer => ({ status: 302, headers: location ? { location } : {} });
    const server = fakeServer({
      "public.example.test/to-private": redirect("https://internal.example.test/secret"),
      "public.example.test/to-ip": redirect("https://127.0.0.1/"),
      "public.example.test/to-http": redirect("http://public.example.test/page"),
      "public.example.test/nowhere": redirect(),
      "public.example.test/1": redirect("/2"),
      "public.example.test/2": redirect("/3"),
      "public.example.test/3": redirect("/4"),
      "public.example.test/4": redirect("/5"),
      "public.example.test/5": page("<p>Too far</p>"),
    });
    const fetch = (path: string) => safeFetchText(`https://public.example.test${path}`, { request: server.request, resolve });
    assert.deepEqual(await fetch("/to-private"), { ok: false, code: "private_address" });
    assert.deepEqual(await fetch("/to-ip"), { ok: false, code: "private_address" });
    assert.deepEqual(await fetch("/to-http"), { ok: false, code: "not_https" });
    assert.deepEqual(await fetch("/nowhere"), { ok: false, code: "bad_redirect" });
    assert.deepEqual(await fetch("/1"), { ok: false, code: "too_many_redirects" });
    assert.deepEqual(await fetch("/2"), { ok: true, contentType: "text/html", text: "<p>Too far</p>" });
    assert.ok(server.requests.every((request) => request.hostname === "public.example.test"), "a redirect to a private host was requested");
  });

  await check("safe fetch: over 2 MB (said or sent), not HTML or plain text, compressed, an error answer, or no answer in time is refused", async () => {
    const resolve = fakeResolver({ "public.example.test": [PUBLIC_V4] });
    const big = Buffer.alloc(1024 * 1024, "a");
    const server = fakeServer({
      "public.example.test/said-big": { status: 200, headers: { "content-type": "text/html", "content-length": String(3 * 1024 * 1024) }, chunks: [] },
      "public.example.test/sent-big": { status: 200, headers: { "content-type": "text/plain" }, chunks: [big, big, Buffer.from("!")] },
      "public.example.test/two-mb": { status: 200, headers: { "content-type": "text/plain" }, chunks: [big, big] },
      "public.example.test/json": page("{}", "application/json"),
      "public.example.test/pdf": page("%PDF", "application/pdf"),
      "public.example.test/gzip": { ...page("x"), headers: { "content-type": "text/html", "content-encoding": "gzip" } },
      "public.example.test/missing": { status: 404, headers: { "content-type": "text/html" }, chunks: [Buffer.from("Not found")] },
      "public.example.test/slow": { status: 200, neverAnswers: true },
    });
    const fetch = (path: string) => safeFetchText(`https://public.example.test${path}`, { request: server.request, resolve, timeoutMs: 200 });
    assert.deepEqual(await fetch("/said-big"), { ok: false, code: "too_large" });
    assert.deepEqual(await fetch("/sent-big"), { ok: false, code: "too_large" });
    const exactlyTwo = await fetch("/two-mb");
    assert.ok(exactlyTwo.ok && exactlyTwo.text.length === 2 * 1024 * 1024);
    assert.deepEqual(await fetch("/json"), { ok: false, code: "wrong_type" });
    assert.deepEqual(await fetch("/pdf"), { ok: false, code: "wrong_type" });
    assert.deepEqual(await fetch("/gzip"), { ok: false, code: "unsupported_encoding" });
    assert.deepEqual(await fetch("/missing"), { ok: false, code: "http_status" });
    const started = Date.now();
    assert.deepEqual(await fetch("/slow"), { ok: false, code: "timeout" });
    assert.ok(Date.now() - started < 2000, "the time limit did not stop it");
  });

  await check("safe fetch: once the time is up nothing more is opened, even when a DNS answer comes later, and every request it opened is closed", async () => {
    // Both late hosts answer DNS 300 ms in, after the 100 ms limit.
    const resolve = fakeResolver(
      { "late-dns.example.test": [PUBLIC_V4], "public.example.test": [PUBLIC_V4], "late-target.example.test": [PUBLIC_V4] },
      { "late-dns.example.test": 300, "late-target.example.test": 300 },
    );
    const server = fakeServer({
      "late-dns.example.test/": page("<p>Too late</p>"),
      "public.example.test/moved": { status: 302, headers: { location: "https://late-target.example.test/page" } },
      "late-target.example.test/page": page("<p>Too late</p>"),
    });
    const fetch = (url: string) => safeFetchText(url, { request: server.request, resolve, timeoutMs: 100 });
    assert.deepEqual(await fetch("https://late-dns.example.test/"), { ok: false, code: "timeout" });
    assert.deepEqual(await fetch("https://public.example.test/moved"), { ok: false, code: "timeout" });
    // Long after both DNS answers came.
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    assert.deepEqual(server.requests.map((request) => request.hostname), ["public.example.test"], "a request was opened after the time limit");
    assert.equal(new Set(server.closed).size, server.requests.length, "a request was left open");
  });

  await check("safe fetch: a public page is fetched from exactly the checked address, with no cookie or credentials, decoded by its charset", async () => {
    const resolve = fakeResolver({ "public.example.test": [PUBLIC_V4, PUBLIC_V6], "other.example.test": [PUBLIC_V4] });
    const server = fakeServer({
      "public.example.test/help?x=1": { status: 301, headers: { location: "https://other.example.test/page" } },
      "other.example.test/page": { status: 200, headers: { "content-type": "text/html; charset=windows-1252" }, chunks: [Buffer.from([0x43, 0x61, 0x66, 0xe9])] },
    });
    const result = await safeFetchText("https://public.example.test/help?x=1", { request: server.request, resolve });
    assert.deepEqual(result, { ok: true, contentType: "text/html", text: "Café" });
    const [first, second] = server.requests;
    assert.deepEqual([first.hostname, first.port, first.path, first.servername, first.agent, first.method], ["public.example.test", 443, "/help?x=1", "public.example.test", false, "GET"]);
    assert.equal(second.hostname, "other.example.test");
    const headerNames = Object.keys(first.headers ?? {}).map((name) => name.toLowerCase());
    assert.ok(!headerNames.includes("cookie") && !headerNames.includes("authorization"), `sent ${headerNames.join(", ")}`);
    // Node's own lookup is answered with the checked addresses only: no second DNS question.
    const lookup = first.lookup;
    assert.ok(lookup, "no pinned lookup");
    const ask = (options: LookupOptions) =>
      new Promise<unknown>((resolveAnswer) => lookup("public.example.test", options, (_error: unknown, address: string | LookupAddress[], family?: number) => resolveAnswer({ address, family })));
    assert.deepEqual(await ask({ all: true }), { address: [{ address: PUBLIC_V4, family: 4 }, { address: PUBLIC_V6, family: 6 }], family: undefined });
    assert.deepEqual(await ask({ family: 6 }), { address: PUBLIC_V6, family: 6 });
    assert.deepEqual(await ask({}), { address: PUBLIC_V4, family: 4 });
  });

  await check("public addresses: private, loopback, link-local, shared, documentation, multicast and mapped forms are not public", async () => {
    const notPublic = [
      "0.1.2.3", "10.0.0.1", "100.64.0.1", "100.127.255.255", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255",
      "192.0.0.8", "192.0.2.1", "192.168.0.1", "198.18.0.1", "198.19.255.255", "198.51.100.7", "203.0.113.9", "224.0.0.1", "240.0.0.1",
      "255.255.255.255", "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%en0", "ff02::1", "2001:db8::1",
      "::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "64:ff9b::10.0.0.1", "64:ff9b::7f00:1", "::127.0.0.1", "not an address", "",
    ];
    for (const address of notPublic) {
      assert.equal(isPublicAddress(address), false, address);
    }
    for (const address of ["8.8.8.8", "1.1.1.1", PUBLIC_V4, "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", PUBLIC_V6, "::ffff:8.8.8.8", "64:ff9b::808:808"]) {
      assert.equal(isPublicAddress(address), true, address);
    }
  });
}
