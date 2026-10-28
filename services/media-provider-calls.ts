import "server-only";
import type { ClaimedGenerationJob } from "@/db/media-generation-runs";
import type { GenerationErrorCode } from "@/lib/media/error-codes";
import type { MediaProvider, ProviderOutput } from "@/lib/media-generation";

// Talking to an image or video service for one claimed request (step 39,
// services/media-generation-runs.ts): one start, then polls while the
// service works in the background, within the run's time budget. A service
// that throws or doesn't answer in time never throws here: every answer
// becomes done, failed (a code) or unfinished.

export type ProviderAnswer =
  | { status: "done"; output: ProviderOutput; costCents: number | null }
  | { status: "failed"; code: GenerationErrorCode; costCents: number | null }
  | { status: "unfinished" };

type AskOptions = {
  budgetMs: number;
  sleep?: (ms: number) => Promise<void>;
  // Keeps the service's job id on the job, before the first poll.
  saveProviderJobId: (providerJobId: string) => Promise<void>;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Asks the service for the claimed request (or, when an earlier run started
// it, only polls the service's job), until it is done, failed, or the run's
// time is up ("unfinished": a later run polls again).
export async function askProvider(provider: MediaProvider, claimed: ClaimedGenerationJob, options: AskOptions): Promise<ProviderAnswer> {
  const deadline = Date.now() + options.budgetMs;
  const sleep = options.sleep ?? wait;
  let providerJobId = claimed.providerJobId;
  let startCost: number | null = null;
  if (!providerJobId) {
    const started = await callWithin(() => provider.start({ kind: claimed.kind, prompt: claimed.prompt }), provider.requestTimeoutMs);
    // No answer in time: the service may or may not have started it, and
    // without its id nobody can ask. An honest failure, not a second request.
    if (started === "timeout") {
      return { status: "failed", code: "provider_timeout", costCents: null };
    }
    if (started === "threw") {
      return { status: "failed", code: "provider_failed", costCents: null };
    }
    if (started.status === "done") {
      return started;
    }
    if (started.status === "failed") {
      return { status: "failed", code: started.code, costCents: null };
    }
    providerJobId = started.providerJobId;
    startCost = started.costCents;
    await options.saveProviderJobId(providerJobId);
  }
  const jobToPoll = providerJobId;
  // Polls while one more wait and one more answer still end before the deadline.
  while (Date.now() + provider.pollIntervalMs + provider.requestTimeoutMs <= deadline) {
    await sleep(provider.pollIntervalMs);
    const polled = await callWithin(() => provider.poll(jobToPoll), provider.requestTimeoutMs);
    // A slow or broken answer to one poll: ask again while there is time.
    if (polled === "timeout" || polled === "threw" || polled.status === "running") {
      continue;
    }
    if (polled.status === "failed") {
      return { status: "failed", code: polled.code, costCents: startCost };
    }
    return { status: "done", output: polled.output, costCents: polled.costCents ?? startCost };
  }
  return { status: "unfinished" };
}

// The call's answer, or "timeout" when it took longer than timeoutMs, or
// "threw" when it failed. The service's error is never looked at (its
// message could quote the prompt).
async function callWithin<T>(call: () => Promise<T>, timeoutMs: number): Promise<T | "timeout" | "threw"> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    return await Promise.race([call().catch((): "threw" => "threw"), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
