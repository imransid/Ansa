// A post number as the pages write it (step 42): 1,234 or 6.5. Pure.
export function formatNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}
