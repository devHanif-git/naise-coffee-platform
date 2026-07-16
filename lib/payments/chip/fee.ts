// Gateway fee math, isolated + pure so it's trivial to reason about and reuse
// (checkout action to build the CHIP purchase, review screen to display it).
// All amounts are integer sen; the percent component is integer basis points
// (150 = 1.50%) to avoid floating-point drift. Rounded to the nearest sen.

export function computeGatewayFee(
  total: number,
  flat: number,
  percentBasisPoints: number,
): number {
  const pct = Math.round((total * percentBasisPoints) / 10000);
  return flat + pct;
}
