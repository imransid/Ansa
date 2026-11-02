// Login redirect checks (step 32, kept for the screens): a page that needs a
// login answers a visitor without a session cookie with a real 307 to
// /login, remembering the page; logging in goes back there, but only to a
// path on this site; the proxy looks for the cookie names core really
// writes; and every page that reads the session is covered and passes its
// own path.

import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { validateHeaderValue } from "node:http";
import path from "node:path";
import { NextRequest } from "next/server";
import { buildLoginUrl, destinationAfterLogin, readSafeReturnPath, SIGNED_IN_SECTIONS } from "@/lib/login-redirect";
import { config as proxyConfig, proxy } from "../../proxy";
import { check } from "./check";
import { read } from "./source-helpers";

const SITE = "http://localhost:3000";

function pageRequest(pathAndQuery: string, init: { method?: string; cookie?: string } = {}): NextRequest {
  const headers = new Headers(init.cookie ? { cookie: init.cookie } : {});
  return new NextRequest(`${SITE}${pathAndQuery}`, { method: init.method ?? "GET", headers });
}

// Where the proxy sent the request ("/login?next=..."), or null when it let it through.
function redirectedTo(response: Response): string | null {
  if (response.headers.get("x-middleware-next") === "1") {
    return null;
  }
  assert.equal(response.status, 307, "a redirect that is not a 307");
  const location = new URL(response.headers.get("location") ?? "", SITE);
  return `${location.pathname}${location.search}`;
}

// The strings of one list literal in a source file, after its name: a
// TypeScript array ["a", "b"], or a Go slice []string{"a", "b"}.
function stringsOfList(source: string, name: string, open: "[" | "{", close: "]" | "}"): string[] {
  const start = source.indexOf(name);
  assert.ok(start >= 0, `${name} not found`);
  const list = source.slice(source.indexOf(open, start), source.indexOf(close, start));
  return [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

// The app's page.tsx files (path under app/) that read the session.
async function pagesThatNeedALogin(): Promise<string[]> {
  const files = await readdir(path.join(process.cwd(), "app"), { recursive: true });
  const needingLogin: string[] = [];
  for (const page of files.filter((file) => path.basename(file) === "page.tsx")) {
    const asPath = page.split(path.sep).join("/");
    if ((await read(`app/${asPath}`)).includes("requireSessionContext(")) {
      needingLogin.push(asPath);
    }
  }
  return needingLogin;
}

export async function runLoginRedirectChecks() {
  await check("login: after logging in, only a path on this site is followed", async () => {
    for (const safe of ["/tickets/412", "/dashboard?view=mine&q=refund", "/calls/5f0c-x", "/setup"]) {
      assert.equal(readSafeReturnPath(safe), safe);
    }
    const unsafe: unknown[] = ["//evil.test", "/\\evil.test", "/\t/evil.test", "/\n/evil.test", "https://evil.test", "javascript:alert(1)", "evil.test", "", " /tickets/1", "/tickets\\..\\x", 42, null, ["/a"], `/${"a".repeat(2001)}`];
    // Not other sites, but Next would write them unencoded into a response
    // header and Node refuses that: the login would work, then fail.
    unsafe.push("/日", "/a b", "/café", "/a\u007fb", "/a\u0085b");
    for (const value of unsafe) {
      assert.equal(readSafeReturnPath(value), null, `followed ${JSON.stringify(value)}`);
      assert.equal(destinationAfterLogin(value), "/dashboard");
    }
    // A path the app builds from a URL is percent-encoded, so plain ASCII: followed.
    const parsed = new URL("http://localhost/calls/日?q=a b&x=é");
    const encoded = `${parsed.pathname}${parsed.search}`;
    // What "followed" means: Next puts it in a header, and Node takes it.
    for (const safe of ["/tickets/412", "/dashboard?view=mine&q=refund", encoded, "/a%20b", "/~x!$&'()*+,;=:@-._"]) {
      assert.equal(readSafeReturnPath(safe), safe, `refused ${safe}`);
      assert.doesNotThrow(() => validateHeaderValue("x-action-redirect", `${safe};push`));
    }
    assert.throws(() => validateHeaderValue("x-action-redirect", "/日;push"));
    assert.equal(buildLoginUrl("/tickets/412?x=1&y=2"), "/login?next=%2Ftickets%2F412%3Fx%3D1%26y%3D2");
  });

  await check("proxy: a page view without a session cookie gets a real 307 to /login that remembers the page", async () => {
    for (const section of SIGNED_IN_SECTIONS) {
      assert.equal(redirectedTo(proxy(pageRequest(section))), buildLoginUrl(section), section);
    }
    assert.equal(redirectedTo(proxy(pageRequest("/tickets/412"))), "/login?next=%2Ftickets%2F412");
    assert.equal(redirectedTo(proxy(pageRequest("/dashboard?view=mine&q=a%20b"))), buildLoginUrl("/dashboard?view=mine&q=a%20b"));
    assert.equal(redirectedTo(proxy(pageRequest("/calls/x", { method: "HEAD" }))), buildLoginUrl("/calls/x"));
    // A cookie that is not a session cookie (core's known-device one) doesn't count.
    assert.equal(redirectedTo(proxy(pageRequest("/team", { cookie: "ansa_known_device=abc" }))), buildLoginUrl("/team"));
  });

  await check("proxy: public pages, form posts (server actions) and visitors with a session cookie go straight through", async () => {
    for (const publicPage of ["/", "/login", "/signup", "/pricing", "/invite", "/verify-email", "/dashboardx", "/api/documents/1"]) {
      assert.equal(redirectedTo(proxy(pageRequest(publicPage))), null, publicPage);
    }
    // A server action checks the session itself and answers with its own redirect.
    assert.equal(redirectedTo(proxy(pageRequest("/tickets/412", { method: "POST" }))), null);
    for (const name of ["better-auth.session_token", "__Secure-better-auth.session_token"]) {
      for (const section of SIGNED_IN_SECTIONS) {
        assert.equal(redirectedTo(proxy(pageRequest(section, { cookie: `${name}=abc.def` }))), null, `${section} with ${name}`);
      }
    }
  });

  await check("proxy: the cookie names it looks for are the ones core writes and reads (else every logged-in person would loop between /login and the app)", async () => {
    const coreNames = stringsOfList(await read("core/internal/session/session.go"), "var cookieNames", "{", "}");
    assert.equal(coreNames.length, 2, "core's cookie names not found");
    assert.deepEqual(stringsOfList(await read("proxy.ts"), "const SESSION_COOKIES", "[", "]"), coreNames);
    assert.deepEqual(stringsOfList(await read("lib/core-api.ts"), "export const SESSION_COOKIES", "[", "]"), coreNames);
  });

  await check("proxy: its matcher covers exactly the signed-in sections, and every page that reads the session is in one", async () => {
    assert.deepEqual(proxyConfig.matcher, SIGNED_IN_SECTIONS.map((section) => `${section}/:path*`));
    const pages = await pagesThatNeedALogin();
    assert.ok(pages.length >= 10, `only ${pages.length} pages read the session`);
    for (const page of pages) {
      const section = `/${page.split("/")[0]}`;
      assert.ok(SIGNED_IN_SECTIONS.includes(section), `app/${page} reads the session but ${section} is not covered by the proxy`);
    }
  });

  await check("pages: every page that needs a login passes its own path, so logging in brings people back to it", async () => {
    for (const page of await pagesThatNeedALogin()) {
      const source = await read(`app/${page}`);
      assert.match(source, /requireSessionContext\(\s*[`"]\//, `app/${page} calls requireSessionContext() without its path`);
    }
  });
}
