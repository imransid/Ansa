import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { SOCIAL_ACCOUNT_KIND_LABELS, SOCIAL_CONNECTION_STATUS_LABELS } from "@/lib/social-platforms";
import type { AccessLifetime, ConnectionView, PlatformView } from "@/services/social-accounts";
import { ConnectButton, StandInConnectButton } from "./connect-buttons";
import { DisconnectButton } from "./disconnect-button";

// A platform's connected accounts (and, folded away, the disconnected
// ones): name, kind, status, the permissions given, when the access runs
// out, what went wrong last, and (owners) Reconnect and Disconnect. The
// development stand-in's are marked as such.
export function ConnectionList({ platform, canManage }: { platform: PlatformView; canManage: boolean }) {
  if (platform.connections.length === 0 && platform.disconnected.length === 0) {
    return <p className="text-sm text-muted-foreground">No {platform.label} account connected.</p>;
  }
  return (
    <div className="grid gap-3">
      {platform.connections.length > 0 ? (
        <ul className="grid gap-3">
          {platform.connections.map((connection) => (
            <li key={connection.id} className="grid gap-2 rounded-md border p-3 text-sm">
              <ConnectionSummary connection={connection} platformLabel={platform.label} />
              {canManage && <ConnectionActions connection={connection} platform={platform} />}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No {platform.label} account connected now.</p>
      )}
      {platform.disconnected.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Disconnected ({platform.disconnected.length})</summary>
          <ul className="mt-2 grid gap-1">
            {platform.disconnected.map((connection) => (
              <li key={connection.id} className="wrap-anywhere">
                {connection.displayName}
                {connection.isStandIn && " (development stand-in)"}, disconnected on{" "}
                {connection.disconnectedAt && <LocalDateTime iso={connection.disconnectedAt.toISOString()} dateOnly />}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ConnectionSummary({ connection, platformLabel }: { connection: ConnectionView; platformLabel: string }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium wrap-anywhere">{connection.displayName}</span>
        <Badge variant="outline">{SOCIAL_ACCOUNT_KIND_LABELS[connection.accountKind]}</Badge>
        <Badge variant={connection.status === "connected" ? "secondary" : "destructive"}>{SOCIAL_CONNECTION_STATUS_LABELS[connection.status]}</Badge>
        {connection.isStandIn && <Badge variant="outline">Development stand-in</Badge>}
      </div>
      {connection.problem && <p className="text-destructive">{connection.problem}</p>}
      <p className="text-muted-foreground">
        Connected on <LocalDateTime iso={connection.connectedAt.toISOString()} dateOnly /> by {connection.connectedByName ?? "a former teammate"}.{" "}
        <AccessLifetimeText lifetime={connection.lifetime} platformLabel={platformLabel} />
      </p>
      <p className="text-xs text-muted-foreground wrap-anywhere">
        Permissions given: {connection.scopes.length > 0 ? connection.scopes.join(", ") : "none named"}.
      </p>
    </>
  );
}

// When the access runs out, and whether ansa renews it on its own, as
// services/social-accounts.ts worked it out (it knows what time it is).
function AccessLifetimeText({ lifetime, platformLabel }: { lifetime: AccessLifetime; platformLabel: string }) {
  switch (lifetime.kind) {
    case "stand-in":
      return <>A stand-in&apos;s access never runs out.</>;
    case "no-end-date":
      return <>{platformLabel} gave this access without an end date.</>;
    case "renews-itself":
      return lifetime.until ? (
        <>
          ansa renews the access on its own until <LocalDateTime iso={lifetime.until.toISOString()} dateOnly />: reconnect before then.
        </>
      ) : (
        <>ansa renews the access on its own before it runs out.</>
      );
    case "runs-out":
      return (
        <>
          The access runs out on <LocalDateTime iso={lifetime.on.toISOString()} dateOnly />: reconnect before then.
        </>
      );
    case "ran-out":
      return (
        <>
          The access ran out on <LocalDateTime iso={lifetime.on.toISOString()} dateOnly />.
        </>
      );
    case "none":
      // The problem above says why.
      return null;
  }
}

// Reconnect is connecting again (the platform's page, or the stand-in);
// Disconnect asks first.
function ConnectionActions({ connection, platform }: { connection: ConnectionView; platform: PlatformView }) {
  const reconnectLabel = `Reconnect ${connection.displayName}`;
  return (
    <div className="flex flex-wrap items-start gap-2">
      {!connection.isStandIn && platform.mode === "real" && <ConnectButton platform={platform.platform} label="Reconnect" accessibleLabel={reconnectLabel} variant="outline" />}
      {connection.isStandIn && platform.mode === "stand-in" && <StandInConnectButton platform={platform.platform} label="Reconnect" accessibleLabel={reconnectLabel} />}
      <DisconnectButton connectionId={connection.id} displayName={connection.displayName} platform={platform.platform} isStandIn={connection.isStandIn} />
    </div>
  );
}
