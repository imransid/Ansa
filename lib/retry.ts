// Runs `attempt`, and again after each delay for as long as its result is a
// temporary failure (an API answering 429 or 5xx, or no answer at all).
// Returns the last result, failed or not. Used for fetching received emails
// from Resend (step 27): one busy second must not lose a customer's email.
// `sleep` is only replaced by the checks, so they don't wait.
export async function retryWhileTemporary<Result>(
  attempt: () => Promise<Result>,
  isTemporaryFailure: (result: Result) => boolean,
  delaysMs: number[],
  sleep: (milliseconds: number) => Promise<void> = waitFor,
): Promise<Result> {
  let result = await attempt();
  for (const delay of delaysMs) {
    if (!isTemporaryFailure(result)) {
      break;
    }
    await sleep(delay);
    result = await attempt();
  }
  return result;
}

function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
