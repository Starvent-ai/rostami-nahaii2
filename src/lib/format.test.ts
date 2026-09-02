import { describe, expect, it } from 'vitest';
import { calcUnitAmount, formatDuration, roundToNearest5000 } from './format';

describe('formatDuration', () => {
  it('formats sub-hour durations as mm:ss', () => {
    expect(formatDuration(65_000)).toBe('01:05');
  });

  it('formats durations over an hour as hh:mm:ss', () => {
    expect(formatDuration(3_661_000)).toBe('01:01:01');
  });

  it('never goes negative', () => {
    expect(formatDuration(-5000)).toBe('00:00');
  });
});

describe('roundToNearest5000', () => {
  it('rounds down when closer to the lower block (27,000 → 25,000)', () => {
    expect(roundToNearest5000(27_000)).toBe(25_000);
  });

  it('rounds up when closer to the upper block (28,000 → 30,000)', () => {
    expect(roundToNearest5000(28_000)).toBe(30_000);
  });

  it('rounds up when closer to the upper block (29,000 → 30,000)', () => {
    expect(roundToNearest5000(29_000)).toBe(30_000);
  });
});

describe('calcUnitAmount', () => {
  it('computes exact cost proportionally with no block-rounding of time', () => {
    // 20 minutes at 180,000 تومان/ساعت → exactly 60,000, never rounded to a time block
    const { exactAmount } = calcUnitAmount(20 * 60_000, 180_000);
    expect(exactAmount).toBe(60_000);
  });

  it('charges proportionally even for very short sessions (no minimum block)', () => {
    const { exactAmount } = calcUnitAmount(2 * 60_000, 180_000);
    expect(exactAmount).toBe(6_000);
  });

  it('rounds the final amount to the nearest 5,000 تومان', () => {
    // 9 minutes at 180,000/hour → exactly 27,000 → rounds to 25,000
    const { exactAmount, roundedAmount } = calcUnitAmount(9 * 60_000, 180_000);
    expect(exactAmount).toBe(27_000);
    expect(roundedAmount).toBe(25_000);
  });
});
