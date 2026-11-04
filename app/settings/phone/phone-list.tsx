import { removeDeviceAction } from "@/app/actions/devices";
import { ConfirmButton } from "@/components/confirm-button";
import { LocalDateTime } from "@/components/local-date-time";
import { StatusDot } from "@/components/status-dot";
import { PLATFORM_LABELS } from "@/lib/devices";
import type { ConnectedDevice } from "@/lib/types/devices";

// Settings → Your phone → Connected phones: each phone's name, kind, when it
// was connected and whether it still checks in. Owners remove one (it asks
// first); members read.
export function PhoneList({ devices, canRemove }: { devices: ConnectedDevice[]; canRemove: boolean }) {
  if (devices.length === 0) {
    return <p className="text-sm text-muted-foreground">No phone is connected yet.</p>;
  }
  return (
    <ul className="divide-y border-y">
      {devices.map((device) => (
        <li key={device.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
          <div className="grid min-w-0 gap-1">
            <p className="font-medium wrap-anywhere">{device.name}</p>
            <p className="text-sm text-muted-foreground">
              {PLATFORM_LABELS[device.platform] ?? "Phone"}, connected <LocalDateTime iso={device.pairedAt} dateOnly />
            </p>
            <CheckIn device={device} />
          </div>
          {canRemove && (
            <ConfirmButton
              action={removeDeviceAction}
              fields={{ deviceId: device.id }}
              label="Remove"
              accessibleLabel={`Remove ${device.name}`}
              question={`Remove ${device.name}? It stops checking in, and the ansa app on it forgets this account. To use it again, connect it with a new code.`}
              confirmLabel="Yes, remove"
              pendingLabel="Removing..."
            />
          )}
        </li>
      ))}
    </ul>
  );
}

// Whether the phone checked in within the wait, and when it last did.
function CheckIn({ device }: { device: ConnectedDevice }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm">
      {device.reachable ? <StatusDot tone="success">Reachable</StatusDot> : <StatusDot tone="quiet">Not reachable</StatusDot>}
      <span className="text-muted-foreground">
        {device.lastSeenAt ? (
          <>
            last check-in <LocalDateTime iso={device.lastSeenAt} timeIfToday />
          </>
        ) : (
          "it hasn't checked in yet"
        )}
      </span>
    </p>
  );
}
