import { QR_QUIET_ZONE, qrSquaresPath } from "@/lib/devices";

// A QR code drawn from core's modules (rows of 0 and 1) as squares in one
// SVG. Black on white in light and dark mode alike, with its blank border
// (the quiet zone) inside the white: a camera reads dark squares on light
// paper, and inverted colours or a dark edge stop many from reading it.
export function QrCode({ rows, label }: { rows: string[]; label: string }) {
  const side = rows.length + 2 * QR_QUIET_ZONE;
  return (
    <svg
      viewBox={`0 0 ${side} ${side}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className="size-64 max-w-full rounded-lg sm:size-72"
    >
      <rect width={side} height={side} fill="#ffffff" />
      <path d={qrSquaresPath(rows)} fill="#000000" />
    </svg>
  );
}
