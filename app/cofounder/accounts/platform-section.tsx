import { Badge } from "@/components/ui/badge";
import type { PlatformView } from "@/services/social-accounts";
import { ConnectButton, StandInConnectButton } from "./connect-buttons";
import { ConnectionList } from "./connection-list";

// One platform on the Accounts page: what it takes, whether ansa has set
// it up, its accounts, and (owners) Connect. In production a platform ansa
// hasn't set up only says so; in development it offers the stand-in, and
// ansa's own operator reads what the platform still needs.
export function PlatformSection({ platform, canManage, showsOperatorNotes }: { platform: PlatformView; canManage: boolean; showsOperatorNotes: boolean }) {
  const headingId = `platform-${platform.platform}`;
  const hasAccounts = platform.connections.length > 0;
  return (
    <section aria-labelledby={headingId} className="grid gap-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-lg font-semibold">
          {platform.label}
        </h2>
        <SetUpBadge mode={platform.mode} />
      </div>

      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[9rem_1fr]">
        <dt className="text-muted-foreground">Publishes</dt>
        <dd>{platform.publishes}</dd>
        <dt className="text-muted-foreground">Media</dt>
        <dd>{platform.facts.media}</dd>
        <dt className="text-muted-foreground">Text</dt>
        <dd>{platform.textLimit}</dd>
        <dt className="text-muted-foreground">Scheduling</dt>
        <dd>{platform.facts.scheduling}</dd>
        <dt className="text-muted-foreground">Its numbers</dt>
        <dd>
          {platform.facts.metrics.join(", ")}. {platform.facts.metricsNote}
        </dd>
      </dl>

      {platform.mode === "not-set-up" && <p className="text-sm">{platform.label} accounts can&apos;t be connected yet.</p>}
      {showsOperatorNotes && <OperatorNotes platform={platform} />}

      <ConnectionList platform={platform} canManage={canManage} />

      {canManage && platform.mode === "real" && <ConnectButton platform={platform.platform} label={hasAccounts ? `Connect another ${platform.label} account` : `Connect ${platform.label}`} />}
      {canManage && platform.mode === "stand-in" && !hasAccounts && <StandInConnectButton platform={platform.platform} label="Connect a stand-in account" />}
    </section>
  );
}

function SetUpBadge({ mode }: { mode: PlatformView["mode"] }) {
  if (mode === "real") {
    return <Badge variant="secondary">Ready to connect</Badge>;
  }
  if (mode === "stand-in") {
    return <Badge variant="outline">Development stand-in</Badge>;
  }
  return <Badge variant="outline">Not set up by ansa yet</Badge>;
}

// Development only (the settings named here mean nothing to customers):
// what the stand-in is, and what ansa must get from the platform first.
function OperatorNotes({ platform }: { platform: PlatformView }) {
  return (
    <div className="grid gap-2 rounded-md border border-dashed p-3 text-sm">
      {platform.missingSettings && (
        <p>
          {platform.label} isn&apos;t set up on this development server ({platform.missingSettings.id} and {platform.missingSettings.secret}{" "}
          are not set), so a stand-in account is offered instead: it connects at once, without {platform.label}, and what
          it publishes is written to .dev-social/{platform.platform}/ instead of being posted.
        </p>
      )}
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">Before customers can connect real accounts:</span> {platform.facts.accessBlocker}
      </p>
      <p className="text-xs text-muted-foreground">
        ansa asks {platform.label} for: {platform.scopesAsked.join(", ")}.
      </p>
    </div>
  );
}
