// Social account page checks (step 40), on the code itself, as
// ui-polish-checks.ts does: the Accounts page is in the Co-Founder's row of
// links, sends logged-out visitors back to itself, asks before Disconnect,
// shows its buttons to owners only and reads no token; its result message
// takes only known codes and goes once an action changes the page; only
// two services decrypt a token; the callback route stays thin and runs on
// every request.

import assert from "node:assert/strict";
import { COFOUNDER_PAGES } from "@/lib/cofounder/pages";
import { connectResults, describeConnectResult } from "@/lib/social-errors";
import { accountsPageResultSchema } from "@/lib/validation/social";
import { check } from "./helpers";
import { appSourceFiles, read, withoutComments } from "./source-helpers";

const PAGE_FILES = [
  "app/cofounder/accounts/page.tsx",
  "app/cofounder/accounts/platform-section.tsx",
  "app/cofounder/accounts/connection-list.tsx",
  "app/cofounder/accounts/connect-buttons.tsx",
  "app/cofounder/accounts/disconnect-button.tsx",
  "app/cofounder/accounts/connect-result-message.tsx",
];

export async function runSocialPageChecks() {
  await check("accounts page: in the Co-Founder's row of links, logging in brings people back to it, Disconnect asks first, its buttons show for owners only, and nothing on it reads a token", async () => {
    assert.ok(COFOUNDER_PAGES.some((page) => page.segment === "accounts" && page.href === "/cofounder/accounts" && page.label === "Accounts"));
    const page = await read("app/cofounder/accounts/page.tsx");
    assert.match(page, /requireSessionContext\("\/cofounder\/accounts"\)/);
    assert.match(page, /<h1/);
    assert.match(await read("app/cofounder/accounts/disconnect-button.tsx"), /<ConfirmButton/);
    const section = withoutComments(await read("app/cofounder/accounts/platform-section.tsx"));
    const buttonLines = section.split("\n").filter((line) => /<(ConnectButton|StandInConnectButton)\b/.test(line));
    assert.equal(buttonLines.length, 2, "the Connect buttons moved: check them here");
    assert.ok(buttonLines.every((line) => /\{canManage && .*<(ConnectButton|StandInConnectButton)\b/.test(line)), "a Connect button shows to members");
    assert.match(withoutComments(await read("app/cofounder/accounts/connection-list.tsx")), /canManage && <ConnectionActions/);
    for (const file of PAGE_FILES) {
      assert.doesNotMatch(withoutComments(await read(file)), /accessToken|refreshToken|TokenEncrypted|decrypt/, `${file} reads a token`);
    }
  });

  await check("accounts page: the result in its address shows only the callback's codes, for a known platform; anything else shows nothing, and every code reads as a plain sentence", async () => {
    assert.ok(accountsPageResultSchema.safeParse({ result: "connected", platform: "facebook", count: "3" }).success);
    for (const odd of [
      { result: "connected<script>", platform: "x" },
      { result: "connected", platform: "myspace" },
      { result: ["connected", "denied"], platform: "x" },
      { result: "connected", platform: "x", count: "1000" },
      {},
    ]) {
      assert.equal(accountsPageResultSchema.safeParse(odd).success, false, JSON.stringify(odd));
    }
    for (const result of connectResults) {
      const sentence = describeConnectResult(result, "LinkedIn", null);
      assert.ok(/^[A-Z].*[.]$/.test(sentence) && !sentence.includes("undefined"), `${result}: ${sentence}`);
    }
    assert.equal(describeConnectResult("connected", "Facebook", 3), "Connected 3 Facebook Pages.");
  });

  await check("accounts page: connecting a stand-in and disconnecting open the page again at its own address, replacing it, so a platform's last result there (?result=...) doesn't stay above what changed", async () => {
    const actions = withoutComments(await read("app/actions/social-accounts.ts"));
    assert.match(actions, /function backToAccountsPageOrErrors\(result: FormResult\)[\s\S]*?redirect\("\/cofounder\/accounts", RedirectType\.replace\);\n\}/);
    for (const action of ["connectStandInAccountAction", "disconnectSocialAccountAction"]) {
      const body = actions.slice(actions.indexOf(`export async function ${action}(`)).split("\n}\n")[0];
      assert.match(body, /return backToAccountsPageOrErrors\(/, `${action} no longer opens the page again`);
    }
  });

  await check("social accounts: only services/social-tokens.ts (before a platform call) and services/social-disconnect.ts (the revoke after a Disconnect) decrypt a token", async () => {
    const decrypting: string[] = [];
    for (const file of await appSourceFiles()) {
      const code = withoutComments(await read(file));
      if (code.includes("socialTokenContext(") && /\bdecrypt\w*\(/.test(code)) {
        decrypting.push(file);
      }
    }
    assert.deepEqual(decrypting.sort(), ["services/social-disconnect.ts", "services/social-tokens.ts"]);
  });

  await check("accounts route: the platforms' callback stays a thin route (the session, the platform and the query handed to the service) that reads the request, so it runs on every request (ƒ in the build)", async () => {
    const route = await read("app/api/social/[platform]/callback/route.ts");
    assert.ok(route.trimEnd().split("\n").length <= 15, "the route grew past ~15 lines");
    assert.match(route, /export async function GET\(request: Request, \{ params \}: RouteContext<"\/api\/social\/\[platform\]\/callback">\)/);
    assert.match(route, /const session = await getSessionContext\(\);/);
    assert.match(route, /return handleSocialCallback\(session, \(await params\)\.platform, new URL\(request\.url\)\.searchParams\);/);
    assert.doesNotMatch(route, /from "@\/(db|adapters)\//);
    assert.match(route, /export const maxDuration = \d+;/);
  });
}
