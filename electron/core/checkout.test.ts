// @vitest-environment node
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { runCheckout, runSplitCheckout } from './checkout';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(path.join(import.meta.dirname, '../db/schema.sql'), 'utf-8');
  db.exec(schema);
  return db;
}

const nowIso = () => new Date().toISOString();

describe('runCheckout', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
    db.prepare('INSERT INTO unit_types (id, name, hourly_rate, round_minutes) VALUES (1, ?, 180000, 15)').run('بیلیارد');
    db.prepare("INSERT INTO units (id, name, unit_type_id, status, start_time) VALUES (1, ?, 1, 'playing', ?)").run(
      'میز ۱',
      new Date(Date.now() - 20 * 60_000).toISOString() // started 20 minutes ago
    );
    db.prepare('INSERT INTO cafe_items (id, name, category, price, stock) VALUES (1, ?, ?, 50000, 10)').run('اسپرسو', 'قهوه');
    db.prepare('INSERT INTO customers (id, name, balance) VALUES (1, ?, 0)').run('مشتری تست');
  });

  it('bills a playing unit the exact proportional cost, rounded to the nearest 5,000 تومان, and frees it', () => {
    // started 9 minutes ago → exact cost = 180,000 * 9/60 = 27,000 → rounds to 25,000 (per spec example)
    db.prepare('UPDATE units SET start_time = ? WHERE id = 1').run(new Date(Date.now() - 9 * 60_000).toISOString());

    const result = runCheckout(db, { unitId: 1, paymentMethod: 'cash' }, nowIso);

    expect(result.exactUnitAmount).toBeCloseTo(27_000, -1);
    expect(result.unitAmount).toBe(25_000);
    expect(result.totalAmount).toBe(25_000);

    const unit = db.prepare('SELECT * FROM units WHERE id = 1').get() as any;
    expect(unit.status).toBe('free');
    expect(unit.start_time).toBeNull();
  });

  it('folds an open cafe tab into the same checkout total', () => {
    db.prepare('INSERT INTO cafe_order_items (unit_id, cafe_item_id, qty, unit_price, created_at) VALUES (1, 1, 2, 50000, ?)').run(
      nowIso()
    );

    const result = runCheckout(db, { unitId: 1, paymentMethod: 'cash' }, nowIso);

    expect(result.cafeAmount).toBe(100_000);
    expect(result.totalAmount).toBe(result.unitAmount + 100_000);

    const linked = db.prepare('SELECT * FROM cafe_order_items WHERE transaction_id = ?').all(result.transactionId);
    expect(linked).toHaveLength(1);
  });

  it('respects a manual override amount during a power outage (§11)', () => {
    const result = runCheckout(db, { unitId: 1, paymentMethod: 'cash', manualAmount: 50_000 }, nowIso);
    expect(result.unitAmount).toBe(50_000);
    expect(result.totalAmount).toBe(50_000);
  });

  it('charges the confirmedUnitAmount the operator was shown on screen, not a fresh live recomputation (reproduced live: a delay before confirming silently billed a larger amount than what was displayed and agreed with the customer)', () => {
    // unit started 20 minutes ago in beforeEach → live recompute right now would give a much
    // higher amount than what the operator supposedly saw when the پایان بازی modal first opened
    // (simulating: operator opened the checkout, screen froze at 30,000/9min, some time passed,
    // then they confirmed — the charge must still be 30,000, not whatever "now" computes to).
    const result = runCheckout(
      db,
      {
        unitId: 1,
        paymentMethod: 'cash',
        confirmedUnitAmount: 30_000,
        confirmedExactUnitAmount: 27_500,
        confirmedDurationMinutes: 9,
      },
      nowIso
    );
    expect(result.unitAmount).toBe(30_000);
    expect(result.exactUnitAmount).toBe(27_500);
    expect(result.durationMinutes).toBe(9);
    expect(result.totalAmount).toBe(30_000);
  });

  it('adds a credit-method sale to the customer ledger balance', () => {
    const result = runCheckout(db, { unitId: 1, paymentMethod: 'credit', customerId: 1 }, nowIso);
    const customer = db.prepare('SELECT * FROM customers WHERE id = 1').get() as any;
    expect(customer.balance).toBe(result.totalAmount);
  });

  it('supports a standalone cafe-only sale with no unit', () => {
    const result = runCheckout(db, { standaloneCafe: [{ cafeItemId: 1, qty: 3 }], paymentMethod: 'cash' }, nowIso);
    expect(result.unitAmount).toBe(0);
    expect(result.cafeAmount).toBe(150_000);

    const item = db.prepare('SELECT * FROM cafe_items WHERE id = 1').get() as any;
    expect(item.stock).toBe(7); // 10 - 3
  });

  it('bills a PS unit by summing the selected number of cumulative tiers (§ very important)', () => {
    db.prepare(
      `INSERT INTO unit_types (id, name, kind, hourly_rate, ps_tier1_price, ps_tier2_price, ps_tier3_price, ps_tier4_price, round_minutes)
       VALUES (2, 'PS', 'ps', 0, 30000, 25000, 20000, 15000, 15)`
    ).run();
    db.prepare(
      "INSERT INTO units (id, name, unit_type_id, status, start_time, active_tiers) VALUES (2, 'PS1', 2, 'playing', ?, 2)"
    ).run(new Date(Date.now() - 58 * 60_000).toISOString()); // 58 minutes ago (safely inside the 45-60min block), 2 tiers selected

    const result = runCheckout(db, { unitId: 2, paymentMethod: 'cash' }, nowIso);

    // effective hourly rate = tier1 (30,000) + tier2 (25,000) = 55,000/hour
    // exact cost for 58 minutes = 55,000 * 58/60 ≈ 53,166.7 → rounds to nearest 5,000 → 55,000
    expect(result.unitAmount).toBe(55_000);
  });
});

describe('runSplitCheckout (دنگی / تقسیم حساب)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
    db.prepare('INSERT INTO unit_types (id, name, hourly_rate, round_minutes) VALUES (1, ?, 180000, 15)').run('بیلیارد');
    db.prepare("INSERT INTO units (id, name, unit_type_id, status, start_time) VALUES (1, ?, 1, 'playing', ?)").run(
      'میز ۱',
      new Date(Date.now() - 9 * 60_000).toISOString() // exact 27,000 → rounds to 25,000
    );
    db.prepare('INSERT INTO cafe_items (id, name, category, price, stock) VALUES (1, ?, ?, 50000, 10)').run('اسپرسو', 'قهوه');
    db.prepare('INSERT INTO cafe_order_items (unit_id, cafe_item_id, qty, unit_price, created_at) VALUES (1, 1, 2, 50000, ?)').run(nowIso());
    db.prepare('INSERT INTO customers (id, name, balance) VALUES (1, ?, 0)').run('مشتری تست');
  });

  it('bills the table time to one payer and the cafe items to another, freeing the unit once', () => {
    const cafeItemId = (db.prepare('SELECT id FROM cafe_order_items WHERE unit_id = 1').get() as any).id;

    const result = runSplitCheckout(
      db,
      {
        unitId: 1,
        parts: [
          { paymentMethod: 'cash', unitAmount: 25_000 },
          { paymentMethod: 'credit', customerId: 1, cafeShares: [{ cafeItemId, amount: 100_000 }] },
        ],
      },
      nowIso
    );

    expect(result.transactionIds).toHaveLength(2);
    expect(result.totalAmount).toBe(25_000 + 100_000);

    const unit = db.prepare('SELECT * FROM units WHERE id = 1').get() as any;
    expect(unit.status).toBe('free');

    const customer = db.prepare('SELECT balance FROM customers WHERE id = 1').get() as any;
    expect(customer.balance).toBe(100_000); // only the cafe part went to credit

    const cashTx = db.prepare("SELECT * FROM transactions WHERE payment_method = 'cash'").get() as any;
    expect(cashTx.unit_amount).toBe(25_000);
    expect(cashTx.cafe_amount).toBe(0);

    const creditTx = db.prepare("SELECT * FROM transactions WHERE payment_method = 'credit'").get() as any;
    expect(creditTx.unit_amount).toBe(0);
    expect(creditTx.cafe_amount).toBe(100_000);
  });

  it('skips a part with nothing assigned to it', () => {
    const result = runSplitCheckout(db, { unitId: 1, parts: [{ paymentMethod: 'cash', unitAmount: 25_000 }, { paymentMethod: 'card' }] }, nowIso);
    expect(result.transactionIds).toHaveLength(1);
  });

  it('splits the table time between two people (دنگی) while the coffee goes wholly to one of them', () => {
    const cafeItemId = (db.prepare('SELECT id FROM cafe_order_items WHERE unit_id = 1').get() as any).id; // 100,000 total

    const result = runSplitCheckout(
      db,
      {
        unitId: 1,
        parts: [
          { paymentMethod: 'card', unitAmount: 12_500, cafeShares: [{ cafeItemId, amount: 100_000 }] },
          { paymentMethod: 'credit', customerId: 1, unitAmount: 12_500 },
        ],
      },
      nowIso
    );

    expect(result.totalAmount).toBe(25_000 + 100_000);
    const customer = db.prepare('SELECT balance FROM customers WHERE id = 1').get() as any;
    expect(customer.balance).toBe(12_500);

    const cafeRows = db.prepare('SELECT * FROM cafe_order_items').all() as any[];
    expect(cafeRows).toHaveLength(1);
    expect(cafeRows[0].transaction_id).not.toBeNull();
  });

  it('fragments a single cafe item split unevenly between three people, preserving the total', () => {
    db.prepare('DELETE FROM cafe_order_items').run();
    db.prepare('INSERT INTO cafe_order_items (unit_id, cafe_item_id, qty, unit_price, created_at) VALUES (1, 1, 1, 100000, ?)').run(nowIso());
    const cafeItemId = (db.prepare('SELECT id FROM cafe_order_items').get() as any).id; // 100,000 total

    const result = runSplitCheckout(
      db,
      {
        unitId: 1,
        parts: [
          { paymentMethod: 'cash', cafeShares: [{ cafeItemId, amount: 34_000 }] },
          { paymentMethod: 'card', cafeShares: [{ cafeItemId, amount: 33_000 }] },
          { paymentMethod: 'cardTransfer', cafeShares: [{ cafeItemId, amount: 33_000 }] },
        ],
      },
      nowIso
    );

    expect(result.transactionIds).toHaveLength(3);
    expect(result.totalAmount).toBe(100_000);

    const rows = db.prepare('SELECT * FROM cafe_order_items').all() as any[];
    expect(rows).toHaveLength(3);
    expect(rows.reduce((s, r) => s + r.qty * r.unit_price, 0)).toBe(100_000);
    expect(rows.every((r) => r.transaction_id !== null)).toBe(true);
  });

  it('applies a مبلغ دستی / کسر مبلغ adjustment as part of one payer\'s share', () => {
    const result = runSplitCheckout(
      db,
      {
        unitId: 1,
        parts: [{ paymentMethod: 'cash', unitAmount: 25_000, adjustAmount: -5_000, adjustNote: 'تخفیف' }],
      },
      nowIso
    );
    expect(result.totalAmount).toBe(20_000);
  });

  it('rejects a part whose total would go negative', () => {
    expect(() =>
      runSplitCheckout(db, { unitId: 1, parts: [{ paymentMethod: 'cash', unitAmount: 5_000, adjustAmount: -10_000 }] }, nowIso)
    ).toThrow();
  });
});
