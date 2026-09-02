// @vitest-environment node
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createOpenTab, deleteOpenTab, endUnitSessionToTab, moveUnitCafeToTab, runSplitTabCheckout, runTabCheckout } from './openTabs';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(path.join(import.meta.dirname, '../db/schema.sql'), 'utf-8');
  db.exec(schema);
  return db;
}

const nowIso = () => new Date().toISOString();

describe('open tabs (حساب باز مشتری)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
    db.prepare('INSERT INTO unit_types (id, name, kind, hourly_rate, round_minutes) VALUES (1, ?, \'billiard\', 180000, 15)').run('بیلیارد');
    db.prepare("INSERT INTO units (id, name, unit_type_id, status, start_time) VALUES (1, ?, 1, 'playing', ?)").run(
      'میز ۱',
      new Date(Date.now() - 9 * 60_000).toISOString() // started 9 minutes ago → exact 27,000 → rounds to 25,000
    );
    db.prepare('INSERT INTO cafe_items (id, name, category, price, stock) VALUES (1, ?, ?, 50000, 10)').run('اسپرسو', 'قهوه');
    db.prepare('INSERT INTO customers (id, name, balance) VALUES (1, ?, 0)').run('مشتری تست');
  });

  it('auto-generates "مهمان N" when no title or customer name is given', () => {
    const id1 = createOpenTab(db, {}, nowIso);
    const id2 = createOpenTab(db, {}, nowIso);
    const t1 = db.prepare('SELECT * FROM open_tabs WHERE id = ?').get(id1) as any;
    const t2 = db.prepare('SELECT * FROM open_tabs WHERE id = ?').get(id2) as any;
    expect(t1.title).toBe('مهمان ۱');
    expect(t2.title).toBe('مهمان ۲');
  });

  it('uses the given title or customer name instead of auto-generating one', () => {
    const id = createOpenTab(db, { customerName: 'علی رضایی' }, nowIso);
    const t = db.prepare('SELECT * FROM open_tabs WHERE id = ?').get(id) as any;
    expect(t.title).toBe('علی رضایی');
  });

  it('ends a linked unit session onto the tab (rounded, per the same pricing rules) and frees the unit', () => {
    const tabId = createOpenTab(db, { title: 'میز پنجره' }, nowIso);
    db.prepare('UPDATE units SET linked_tab_id = ? WHERE id = 1').run(tabId);

    const result = endUnitSessionToTab(db, 1, nowIso);
    expect(result.tabId).toBe(tabId);
    expect(result.amount).toBe(25_000); // 27,000 exact → nearest 5,000

    const unit = db.prepare('SELECT * FROM units WHERE id = 1').get() as any;
    expect(unit.status).toBe('free');
    expect(unit.start_time).toBeNull();
    expect(unit.linked_tab_id).toBeNull();

    const sessions = db.prepare('SELECT * FROM open_tab_unit_sessions WHERE tab_id = ?').all(tabId) as any[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0].amount).toBe(25_000);
  });

  it('throws when ending a session for a unit that is not linked to a tab', () => {
    expect(() => endUnitSessionToTab(db, 1, nowIso)).toThrow();
  });

  it('routes an unlinked (normally-started) game onto a tab when an explicit tabId is given at checkout time', () => {
    // unit 1 was started normally in beforeEach — no linked_tab_id at all.
    const tabId = createOpenTab(db, { title: 'تصمیم در پایان بازی' }, nowIso);
    const unitBefore = db.prepare('SELECT linked_tab_id FROM units WHERE id = 1').get() as any;
    expect(unitBefore.linked_tab_id).toBeNull();

    const result = endUnitSessionToTab(db, 1, nowIso, tabId);
    expect(result.tabId).toBe(tabId);
    expect(result.amount).toBe(25_000);

    const unit = db.prepare('SELECT * FROM units WHERE id = 1').get() as any;
    expect(unit.status).toBe('free');

    const sessions = db.prepare('SELECT * FROM open_tab_unit_sessions WHERE tab_id = ?').all(tabId) as any[];
    expect(sessions).toHaveLength(1);
  });

  it('moves cafe orders already attached to a unit onto a tab, so nothing already ordered is left unbilled', () => {
    db.prepare('INSERT INTO cafe_order_items (unit_id, cafe_item_id, qty, unit_price, created_at) VALUES (1, 1, 2, 50000, ?)').run(nowIso());
    const tabId = createOpenTab(db, { title: 'حساب دیرهنگام' }, nowIso);

    moveUnitCafeToTab(db, 1, tabId);

    const item = db.prepare('SELECT * FROM cafe_order_items WHERE cafe_item_id = 1').get() as any;
    expect(item.tab_id).toBe(tabId);
    expect(item.unit_id).toBeNull();
  });

  it('deletes a tab, restoring cafe stock for any pending items and clearing any unit still pointed at it', () => {
    const tabId = createOpenTab(db, { title: 'اشتباهی ساخته شد' }, nowIso);
    db.prepare('INSERT INTO cafe_order_items (tab_id, cafe_item_id, qty, unit_price, created_at) VALUES (?, 1, 3, 50000, ?)').run(tabId, nowIso());
    db.prepare('UPDATE units SET linked_tab_id = ? WHERE id = 1').run(tabId);
    db.prepare("UPDATE units SET status = 'reserved', start_time = NULL WHERE id = 1").run(); // not actively playing

    const stockBefore = (db.prepare('SELECT stock FROM cafe_items WHERE id = 1').get() as any).stock;
    deleteOpenTab(db, tabId, nowIso);

    expect(db.prepare('SELECT * FROM open_tabs WHERE id = ?').get(tabId)).toBeUndefined();
    const stockAfter = (db.prepare('SELECT stock FROM cafe_items WHERE id = 1').get() as any).stock;
    expect(stockAfter).toBe(stockBefore + 3);
    const unit = db.prepare('SELECT linked_tab_id FROM units WHERE id = 1').get() as any;
    expect(unit.linked_tab_id).toBeNull();
  });

  it('refuses to delete a tab that has a game actively playing on it', () => {
    const tabId = createOpenTab(db, { title: 'بازی در جریان' }, nowIso);
    db.prepare('UPDATE units SET linked_tab_id = ? WHERE id = 1').run(tabId); // unit 1 is already 'playing' per beforeEach

    expect(() => deleteOpenTab(db, tabId, nowIso)).toThrow();
  });

  it('combines cafe orders and unit sessions into one checkout, tagging every transaction with the tab id', () => {
    const tabId = createOpenTab(db, { title: 'گروه علی' }, nowIso);
    db.prepare('UPDATE units SET linked_tab_id = ? WHERE id = 1').run(tabId);
    endUnitSessionToTab(db, 1, nowIso); // adds a 25,000 unit session

    db.prepare('INSERT INTO cafe_order_items (tab_id, cafe_item_id, qty, unit_price, created_at) VALUES (?, 1, 2, 50000, ?)').run(
      tabId,
      nowIso()
    );

    const result = runTabCheckout(db, { tabId, paymentMethod: 'cash' }, nowIso);

    expect(result.unitAmount).toBe(25_000);
    expect(result.cafeAmount).toBe(100_000);
    expect(result.totalAmount).toBe(125_000);
    expect(result.transactionIds).toHaveLength(2); // one per unit session + one combined cafe row

    for (const txId of result.transactionIds) {
      const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId) as any;
      expect(tx.tab_id).toBe(tabId);
    }

    const tab = db.prepare('SELECT * FROM open_tabs WHERE id = ?').get(tabId) as any;
    expect(tab.status).toBe('closed');
    expect(tab.closed_at).not.toBeNull();
  });

  it('charges a credit (حساب دفتری) tab checkout to the customer ledger balance', () => {
    const tabId = createOpenTab(db, { title: 'مشتری نسیه' }, nowIso);
    db.prepare('UPDATE units SET linked_tab_id = ? WHERE id = 1').run(tabId);
    endUnitSessionToTab(db, 1, nowIso);

    const result = runTabCheckout(db, { tabId, paymentMethod: 'credit', customerId: 1 }, nowIso);
    const customer = db.prepare('SELECT * FROM customers WHERE id = 1').get() as any;
    expect(customer.balance).toBe(result.totalAmount);
  });

  it('refuses to check out a tab that is already closed', () => {
    const tabId = createOpenTab(db, {}, nowIso);
    db.prepare('UPDATE units SET linked_tab_id = ? WHERE id = 1').run(tabId);
    endUnitSessionToTab(db, 1, nowIso);
    runTabCheckout(db, { tabId, paymentMethod: 'cash' }, nowIso);

    expect(() => runTabCheckout(db, { tabId, paymentMethod: 'cash' }, nowIso)).toThrow();
  });
});

describe('runSplitTabCheckout (تقسیم حساب باز بین چند نفر)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
    db.prepare('INSERT INTO unit_types (id, name, kind, hourly_rate, round_minutes) VALUES (1, ?, \'billiard\', 180000, 15)').run('بیلیارد');
    db.prepare("INSERT INTO units (id, name, unit_type_id, status, start_time) VALUES (1, ?, 1, 'playing', ?)").run(
      'میز ۱',
      new Date(Date.now() - 9 * 60_000).toISOString() // → 25,000 rounded
    );
    db.prepare('INSERT INTO cafe_items (id, name, category, price, stock) VALUES (1, ?, ?, 50000, 10)').run('اسپرسو', 'قهوه');
    db.prepare('INSERT INTO customers (id, name, balance) VALUES (1, ?, 0)').run('مشتری تست');
  });

  it('bills the game session to one payer and cafe items to another, closing the tab once everything is assigned', () => {
    const tabId = createOpenTab(db, { title: 'دو نفره' }, nowIso);
    db.prepare('UPDATE units SET linked_tab_id = ? WHERE id = 1').run(tabId);
    const session = endUnitSessionToTab(db, 1, nowIso);
    db.prepare('INSERT INTO cafe_order_items (tab_id, cafe_item_id, qty, unit_price, created_at) VALUES (?, 1, 1, 50000, ?)').run(tabId, nowIso());
    const cafeItemId = (db.prepare('SELECT id FROM cafe_order_items WHERE tab_id = ?').get(tabId) as any).id;

    const result = runSplitTabCheckout(
      db,
      {
        tabId,
        parts: [
          { paymentMethod: 'cash', sessionShares: [{ sessionId: session.sessionId, amount: 25_000 }] },
          { paymentMethod: 'credit', customerId: 1, cafeShares: [{ cafeItemId, amount: 50_000 }] },
        ],
      },
      nowIso
    );

    expect(result.tabClosed).toBe(true);
    expect(result.unitAmount).toBe(25_000);
    expect(result.cafeAmount).toBe(50_000);

    const customer = db.prepare('SELECT balance FROM customers WHERE id = 1').get() as any;
    expect(customer.balance).toBe(50_000);

    const tab = db.prepare('SELECT * FROM open_tabs WHERE id = ?').get(tabId) as any;
    expect(tab.status).toBe('closed');
  });

  it('leaves the tab open when only some pending items were assigned to a part', () => {
    const tabId = createOpenTab(db, { title: 'ناقص' }, nowIso);
    db.prepare('UPDATE units SET linked_tab_id = ? WHERE id = 1').run(tabId);
    const session = endUnitSessionToTab(db, 1, nowIso);
    db.prepare('INSERT INTO cafe_order_items (tab_id, cafe_item_id, qty, unit_price, created_at) VALUES (?, 1, 1, 50000, ?)').run(tabId, nowIso());

    const result = runSplitTabCheckout(
      db,
      { tabId, parts: [{ paymentMethod: 'cash', sessionShares: [{ sessionId: session.sessionId, amount: 25_000 }] }] },
      nowIso
    );

    expect(result.tabClosed).toBe(false);
    const tab = db.prepare('SELECT * FROM open_tabs WHERE id = ?').get(tabId) as any;
    expect(tab.status).toBe('open');
    // the cafe line is still pending, unbilled
    const pendingCafe = db.prepare('SELECT * FROM cafe_order_items WHERE tab_id = ? AND transaction_id IS NULL').all(tabId);
    expect(pendingCafe).toHaveLength(1);
  });

  it('splits a single game session between two people (دنگی on the table time itself)', () => {
    const tabId = createOpenTab(db, { title: 'دنگی' }, nowIso);
    db.prepare('UPDATE units SET linked_tab_id = ? WHERE id = 1').run(tabId);
    const session = endUnitSessionToTab(db, 1, nowIso); // 25,000 total

    const result = runSplitTabCheckout(
      db,
      {
        tabId,
        parts: [
          { paymentMethod: 'cash', sessionShares: [{ sessionId: session.sessionId, amount: 12_500 }] },
          { paymentMethod: 'credit', customerId: 1, sessionShares: [{ sessionId: session.sessionId, amount: 12_500 }] },
        ],
      },
      nowIso
    );

    expect(result.tabClosed).toBe(true);
    expect(result.unitAmount).toBe(25_000);
    expect(result.transactionIds).toHaveLength(2);

    const customer = db.prepare('SELECT balance FROM customers WHERE id = 1').get() as any;
    expect(customer.balance).toBe(12_500);

    const sessions = db.prepare('SELECT * FROM open_tab_unit_sessions').all() as any[];
    expect(sessions).toHaveLength(2);
    expect(sessions.reduce((s, r) => s + r.duration_minutes, 0)).toBe(session.durationMinutes);
  });

  it('applies a مبلغ دستی adjustment to one payer without affecting the others', () => {
    const tabId = createOpenTab(db, { title: 'با مبلغ دستی' }, nowIso);
    db.prepare('UPDATE units SET linked_tab_id = ? WHERE id = 1').run(tabId);
    const session = endUnitSessionToTab(db, 1, nowIso); // 25,000

    const result = runSplitTabCheckout(
      db,
      {
        tabId,
        parts: [
          {
            paymentMethod: 'cash',
            sessionShares: [{ sessionId: session.sessionId, amount: 25_000 }],
            adjustAmount: 10_000,
            adjustNote: 'تخفیف مدیریت',
          },
        ],
      },
      nowIso
    );

    expect(result.tabClosed).toBe(true);
    expect(result.totalAmount).toBe(35_000);
  });
});
