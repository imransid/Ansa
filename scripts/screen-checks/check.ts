// One named check: PASS, or FAIL with what went wrong. The runner
// (scripts/check-screens.ts) counts the failures and exits non-zero on any.
let failures = 0;

export async function check(description: string, run: () => Promise<void>) {
  try {
    await run();
    console.log(`PASS  ${description}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${description}`);
    console.log(`      ${error instanceof Error ? error.message : error}`);
  }
}

export function getFailureCount(): number {
  return failures;
}
