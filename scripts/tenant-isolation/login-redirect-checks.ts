// Login redirect checks (step 32): a page that needs a login answers a
// visitor without a session cookie with a real 307 to /login, remembering the
// page; logging in goes back there, but only to a path on this site; the
// proxy recognises the cookie Better Auth really sets; and every page that
// reads the session is covered and passes its own path.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { validateHeaderValue } from "node:http";
import path from "node:path";
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { KNOWN_DEVICE_COOKIE_NAME } from "@/lib/known-device";
import { buildLoginUrl, destinationAfterLogin, readSafeReturnPath, SIGNED_IN_SECTIONS } from "@/lib/login-redirect";
import { getSessionContextFromHeaders } from "@/lib/session-context";
import { config as proxyConfig, proxy } from "../../proxy";
import { check, testPassword, type TestUser } from "./helpers";

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

// Every cookie a login sets, sent back the way a browser would.
async function cookiesAfterLogin(user: TestUser): Promise<string> {
  const { headers } = await auth.api.signInEmail({ body: { email: user.email, password: testPassword }, returnHeaders: true });
  return headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}

// The app's page.tsx files (path from the repo root) that read the session.
async function pagesThatNeedALogin(): Promise<string[]> {
  const appFolder = path.join(process.cwd(), "app");
  const files = await readdir(appFolder, { recursive: true });
  const pages = files.filter((file) => path.basename(file) === "page.tsx");
  const needingLogin: string[] = [];
  for (const page of pages) {
    if ((await readFile(path.join(appFolder, page), "utf8")).includes("requireSessionContext(")) {
      needingLogin.push(page.split(path.sep).join("/"));
    }
  }
  return needingLogin;
}

export async function runLoginRedirectChecks(ownerA: TestUser) {
  await check("login: after logging in, only a path on this site is followed", async () => {
    for (const safe of ["/tickets/412", "/dashboard?view=mine&q=refund", "/calls/5f0c-x", "/setup"]) {
      assert.equal(readSafeReturnPath(safe), safe);
    }
    const unsafe = ["//evil.test", "/\\evil.test", "/\t/evil.test", "/\n/evil.test", "https://evil.test", "javascript:alert(1)", "evil.test", "", " /tickets/1", "/tickets\\..\\x", 42, null, ["/a"], `/${"a".repeat(2001)}`];
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
    // A cookie that is not a session cookie (the known-device one) doesn't count.
    assert.equal(redirectedTo(proxy(pageRequest("/team", { cookie: `${KNOWN_DEVICE_COOKIE_NAME}=abc` }))), buildLoginUrl("/team"));
  });

  await check("proxy: public pages, form posts (server actions) and visitors with a session cookie go straight through", async () => {
    for (const publicPage of ["/", "/login", "/signup", "/pricing", "/invite", "/verify-email", "/dashboardx", "/api/documents/1"]) {
      assert.equal(redirectedTo(proxy(pageRequest(publicPage))), null, publicPage);
    }
    // A server action checks the session itself and answers with its own redirect.
    assert.equal(redirectedTo(proxy(pageRequest("/tickets/412", { method: "POST" }))), null);
    const cookies = await cookiesAfterLogin(ownerA);
    for (const section of SIGNED_IN_SECTIONS) {
      assert.equal(redirectedTo(proxy(pageRequest(section, { cookie: cookies }))), null, `${section} with a session cookie`);
    }
  });

  await check("proxy: the cookie it looks for is the one Better Auth really sets at login, and it logs that person in", async () => {
    const cookies = await cookiesAfterLogin(ownerA);
    // If Better Auth renamed its cookie, the proxy would send every logged-in
    // person to /login, and /login would send them back: a loop.
    assert.equal(redirectedTo(proxy(pageRequest("/dashboard", { cookie: cookies }))), null);
    const session = await getSessionContextFromHeaders(new Headers({ cookie: cookies }));
    assert.equal(session?.companyId, ownerA.companyId);
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
      const source = await readFile(path.join(process.cwd(), "app", page), "utf8");
      assert.match(source, /requireSessionContext\(\s*[`"]\//, `app/${page} calls requireSessionContext() without its path`);
    }
  });
}
