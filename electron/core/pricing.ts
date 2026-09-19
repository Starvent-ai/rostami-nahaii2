/**
 * SQL expression computing the effective hourly rate for a joined
 * units+unit_types row (aliased "u" and "ut"). Billiard units use their flat
 * hourly_rate; PS units use the price of the ONE tier selected at session
 * start (u.active_tiers, 1-4) — each دسته is its own flat rate, not summed
 * with the tiers below it. Alias this AS hourly_rate so downstream code can
 * keep reading unit.hourly_rate unchanged.
 */
export const EFFECTIVE_HOURLY_RATE_SQL = `
  CASE WHEN ut.kind = 'ps' THEN
    CASE COALESCE(u.active_tiers, 1)
      WHEN 1 THEN ut.ps_tier1_price
      WHEN 2 THEN ut.ps_tier2_price
      WHEN 3 THEN ut.ps_tier3_price
      WHEN 4 THEN ut.ps_tier4_price
      ELSE ut.ps_tier1_price
    END
  ELSE ut.hourly_rate END
`;

/** Rounds a price to the NEAREST 5,000 تومان — e.g. 27,000 → 25,000; 28,000/29,000 → 30,000. */
export function roundToNearest5000(amount: number): number {
  return Math.round(amount / 5000) * 5000;
}

export interface UnitPriceResult {
  /** exact elapsed minutes, unrounded */
  exactMinutes: number;
  /** exact cost — proportional to exact elapsed time, never block-rounded (shown live during play and as the precise figure at checkout) */
  exactAmount: number;
  /** exactAmount rounded to the nearest 5,000 تومان — the actual charged/final amount */
  roundedAmount: number;
}

export function calcUnitPrice(elapsedMs: number, hourlyRate: number): UnitPriceResult {
  const exactMinutes = elapsedMs / 60000;
  const exactAmount = (exactMinutes / 60) * hourlyRate;
  const roundedAmount = roundToNearest5000(exactAmount);
  return { exactMinutes, exactAmount, roundedAmount };
}
