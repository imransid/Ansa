import "server-only";
import { devMediaGenerator } from "@/adapters/dev-media-generator";
import { env } from "@/lib/env";
import type { GenerationErrorCode } from "@/lib/media/error-codes";
import type { MediaKind, MediaProviderName } from "@/lib/media/kinds";

// Image and video generation (step 39): what every service that makes them
// offers, and which one this server uses. Core code (the services) only
// talks to a MediaProvider; each service is one adapter file (/adapters),
// listed in PROVIDERS. Adding one = its adapter, one line in PROVIDERS and
// its name in lib/media/kinds.ts (mediaProviderNames, which lib/env.ts reads).
// No real service is chosen yet (IMPLEMENTATION_PLAN.md, decision 9).

export type GenerationRequest = { kind: MediaKind; prompt: string };

// The finished file: its bytes, or an https address to fetch them from at
// once (a service's links expire within minutes; they are copied into our
// own storage, from the service's own hosts only). The type it states is
// never trusted: the bytes are checked (lib/media/signatures.ts).
export type ProviderOutput = { bytes: Buffer; statedType: string } | { url: string };

// costCents: what the service charged, when it says (null: unknown).
export type ProviderStart =
  | { status: "done"; output: ProviderOutput; costCents: number | null }
  | { status: "started"; providerJobId: string; costCents: number | null }
  | { status: "failed"; code: GenerationErrorCode };

export type ProviderPoll =
  | { status: "running" }
  | { status: "done"; output: ProviderOutput; costCents: number | null }
  | { status: "failed"; code: GenerationErrorCode };

export type MediaProvider = {
  // Stored on each job and asset (lowercase letters, digits and "-");
  // "dev-stand-in" is shown as "Development stand-in".
  name: string;
  // Not a real service: refused in production (decision 6), labeled everywhere.
  isStandIn: boolean;
  // What it makes. A video asked of an image-only service fails honestly.
  kinds: readonly MediaKind[];
  // The only hosts (https, default port) its output addresses may point at.
  outputHosts: readonly string[];
  // How long one start or poll may take, and how long to wait between polls.
  requestTimeoutMs: number;
  pollIntervalMs: number;
  // Asks for one image or video: the file itself, or the service's job id to poll.
  start(request: GenerationRequest): Promise<ProviderStart>;
  // Asks how a job it started is doing.
  poll(providerJobId: string): Promise<ProviderPoll>;
};

// "on": requests go to this service. "off": production without a real
// service; nothing is asked for, and the pages say it isn't set up.
export type MediaGenerationMode = { kind: "on"; provider: MediaProvider } | { kind: "off" };

// Every service there is, by MEDIA_PROVIDER's value.
const PROVIDERS: Record<MediaProviderName, MediaProvider> = {
  "dev-stand-in": devMediaGenerator,
};

const OFF: MediaGenerationMode = { kind: "off" };

// Which service makes images and videos, from the MEDIA_PROVIDER setting
// and the NODE_ENV the server runs with. Takes both as arguments so the
// checks can try production without running in it. Unset in development is
// the stand-in; a stand-in in production is refused (off).
export function mediaGenerationModeFor(setting: MediaProviderName | undefined, nodeEnv: string | undefined): MediaGenerationMode {
  const isProduction = nodeEnv === "production";
  const provider = setting ? PROVIDERS[setting] : isProduction ? undefined : devMediaGenerator;
  if (!provider || (provider.isStandIn && isProduction)) {
    return OFF;
  }
  return { kind: "on", provider };
}

// The mode for this server's own settings (see mediaGenerationModeFor).
export function currentMediaGenerationMode(): MediaGenerationMode {
  return mediaGenerationModeFor(env.MEDIA_PROVIDER, process.env.NODE_ENV);
}

// The service a job was asked of, if this server still uses it: a job made
// with the stand-in is never run by a production server, and one made
// before MEDIA_PROVIDER changed is not sent to another service.
export function providerForJob(providerName: string, mode: MediaGenerationMode = currentMediaGenerationMode()): MediaProvider | null {
  return mode.kind === "on" && mode.provider.name === providerName ? mode.provider : null;
}
