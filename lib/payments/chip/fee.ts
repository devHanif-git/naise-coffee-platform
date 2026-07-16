// Gateway fee math, isolated + pure so it's trivial to reason about and reuse
// (checkout action to build the CHIP purchase, review screen to display it).
// All amounts are integer sen; the percent component is integer basis points
// (150 = 1.50%) to avoid floating-point drift. Rounded to the nearest sen.
//
// The raw fee is flat + percent, then clamped into [min, max]. min/max are in
// sen; a value of 0 means "no bound" (0 min = no floor, 0 max = no cap), so the
// clamp is opt-in. Typical DuitNow QR: min 15 (RM0.15), max 150 (RM1.50).

export type ChipFeeConfig = {
  flat: number;
  percentBasisPoints: number;
  min: number;
  max: number;
};

export function computeGatewayFee(total: number, cfg: ChipFeeConfig): number {
  const pct = Math.round((total * cfg.percentBasisPoints) / 10000);
  let fee = cfg.flat + pct;
  if (cfg.min > 0) fee = Math.max(fee, cfg.min);
  if (cfg.max > 0) fee = Math.min(fee, cfg.max);
  return fee;
}
