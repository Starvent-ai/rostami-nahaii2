/** mm:ss or hh:mm:ss countup display for a live unit timer. */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Rounds a price to the NEAREST 5,000 تومان — e.g. 27,000 → 25,000; 28,000/29,000 → 30,000. */
export function roundToNearest5000(amount: number): number {
  return Math.round(amount / 5000) * 5000;
}

/**
 * Exact cost proportional to elapsed time (never block-rounded), plus the
 * amount rounded to the nearest 5,000 تومان. Mirrors electron/core/pricing.ts
 * exactly, kept here too so the renderer can show a live, ticking, exact
 * price next to the timer without an IPC round-trip every second.
 */
export function calcUnitAmount(elapsedMs: number, hourlyRate: number) {
  const exactMinutes = elapsedMs / 60000;
  const exactAmount = (exactMinutes / 60) * hourlyRate;
  const roundedAmount = roundToNearest5000(exactAmount);
  return { exactMinutes, exactAmount, roundedAmount };
}
