import type Database from 'better-sqlite3';
import { calcUnitPrice, EFFECTIVE_HOURLY_RATE_SQL } from './pricing.js';
import { resolveCafeShares, type CafeShareClaim } from './cafeSplit.js';

/**
 * حساب باز مشتری (Open Tab) — lets a customer's cafe orders and unit (billiard/PS)
 * game sessions accumulate across a visit and be checked out together at the end,
 * instead of being paid one at a time. Kept in its own module (rather than
 * checkout.ts) since it is a distinct feature with its own tables, even though
 * the final checkout reuses the exact same rounding/payment-method rules.
 */

export interface NewTabInput {
  title?: string;
  customerName?: string;
  phone?: string;
  guestCount?: number;
  note?: string;
}

/** Creates a new open tab. Auto-generates "مهمان N" when no title/customer name was given. */
export function createOpenTab(db: Database.Database, input: NewTabInput, nowIso: () => string): number {
  const typedTitle = input.title?.trim() || input.customerName?.trim();
  const title = typedTitle || nextGuestTitle(db);
  const r = db
    .prepare(
      `INSERT INTO open_tabs (title, customer_name, phone, guest_count, note, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?)`
    )
    .run(title, input.customerName?.trim() || null, input.phone?.trim() || null, input.guestCount ?? null, input.note?.trim() || null, nowIso());
  return r.lastInsertRowid as number;
}

function nextGuestTitle(db: Database.Database): string {
  const count = (db.prepare('SELECT COUNT(*) c FROM open_tabs').get() as { c: number }).c;
  return `مهمان ${(count + 1).toLocaleString('fa-IR')}`;
}

export interface EndUnitSessionResult {
  sessionId: number;
  tabId: number;
  durationMinutes: number;
  exactAmount: number;
  amount: number;
}

/**
 * Ends a unit session and adds it to an open tab — WITHOUT taking payment,
 * since that happens later when the whole tab is checked out. Normally the
 * unit was already linked to the tab when the game started (unit.linked_tab_id),
 * but `explicitTabId` lets staff decide this at end-game time instead — e.g. a
 * game that was started as a normal quick "شروع بازی" (no tab) can still be
 * routed onto a tab from the end-game/checkout screen.
 */
export function endUnitSessionToTab(
  db: Database.Database,
  unitId: number,
  nowIso: () => string,
  explicitTabId?: number
): EndUnitSessionResult {
  return db.transaction(() => {
    const unit = db
      .prepare(
        `SELECT u.*, ut.kind as unit_kind, (${EFFECTIVE_HOURLY_RATE_SQL}) as hourly_rate
         FROM units u JOIN unit_types ut ON ut.id = u.unit_type_id WHERE u.id = ?`
      )
      .get(unitId) as any;
    if (!unit) throw new Error('unit not found');
    const tabId = explicitTabId ?? unit.linked_tab_id;
    if (!tabId) throw new Error('این میز/سیستم به حساب بازی متصل نیست');
    if (!unit.start_time) throw new Error('این میز/سیستم در حال بازی نیست');

    const elapsedMs = Date.now() - new Date(unit.start_time).getTime();
    const priced = calcUnitPrice(elapsedMs, unit.hourly_rate);
    const durationMinutes = Math.round(priced.exactMinutes);

    const r = db
      .prepare(
        `INSERT INTO open_tab_unit_sessions
         (tab_id, unit_id, unit_type_id, unit_kind, unit_name, duration_minutes, exact_amount, amount, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        tabId,
        unit.id,
        unit.unit_type_id,
        unit.unit_kind,
        unit.name,
        durationMinutes,
        Math.round(priced.exactAmount),
        priced.roundedAmount,
        unit.start_time,
        nowIso()
      );

    db.prepare(
      "UPDATE units SET status = 'free', start_time = NULL, current_customer_id = NULL, active_tiers = NULL, linked_tab_id = NULL WHERE id = ?"
    ).run(unitId);

    return {
      sessionId: r.lastInsertRowid as number,
      tabId,
      durationMinutes,
      exactAmount: priced.exactAmount,
      amount: priced.roundedAmount,
    };
  })();
}

/**
 * Moves any cafe orders still attached directly to a unit (added while the
 * unit was NOT yet linked to a tab, via the normal "+ سفارش کافه" flow) onto
 * an open tab. Used when staff decide at end-game/checkout time — rather
 * than when the game started — to route everything to a tab, so nothing
 * already ordered gets left behind unbilled.
 */
export function moveUnitCafeToTab(db: Database.Database, unitId: number, tabId: number): void {
  db.prepare('UPDATE cafe_order_items SET tab_id = ?, unit_id = NULL WHERE unit_id = ? AND transaction_id IS NULL').run(tabId, unitId);
}

export interface TabCheckoutInput {
  tabId: number;
  paymentMethod: 'cash' | 'card' | 'credit' | 'cardTransfer';
  customerId?: number;
  employeeId?: number;
  shiftId?: number;
  adjustAmount?: number; // مبلغ دستی (positive) or کسر مبلغ (negative)
  adjustNote?: string;
  note?: string;
}

export interface TabCheckoutResult {
  transactionIds: number[];
  unitAmount: number;
  cafeAmount: number;
  totalAmount: number;
}

/**
 * Closes an open tab: turns every pending unit session and cafe line into
 * normal `transactions` rows (one per unit session, so existing per-unit-type
 * accounting/reports breakdowns keep working unchanged; one combined row for
 * all cafe lines), all tagged with tab_id so گزارش‌ها can pull the whole visit
 * back together. Reuses the exact same rounding (already applied when each
 * session was ended onto the tab) and payment-method handling as a normal
 * checkout — nothing new to learn for staff.
 */
export function runTabCheckout(db: Database.Database, input: TabCheckoutInput, nowIso: () => string): TabCheckoutResult {
  return db.transaction(() => {
    const tab = db.prepare('SELECT * FROM open_tabs WHERE id = ?').get(input.tabId) as any;
    if (!tab) throw new Error('حساب یافت نشد');
    if (tab.status !== 'open') throw new Error('این حساب قبلاً بسته شده است');

    const sessions = db
      .prepare('SELECT * FROM open_tab_unit_sessions WHERE tab_id = ? AND transaction_id IS NULL')
      .all(input.tabId) as any[];
    const cafeLines = db
      .prepare('SELECT * FROM cafe_order_items WHERE tab_id = ? AND transaction_id IS NULL')
      .all(input.tabId) as any[];

    const transactionIds: number[] = [];
    let unitAmount = 0;
    let cafeAmount = 0;

    const insertTx = db.prepare(
      `INSERT INTO transactions
       (kind, unit_id, unit_type_id, duration_minutes, unit_amount, cafe_amount, total_amount, payment_method, customer_id, employee_id, shift_id, manual_override, tab_id, note, created_at)
       VALUES (@kind, @unit_id, @unit_type_id, @duration_minutes, @unit_amount, @cafe_amount, @total_amount, @payment_method, @customer_id, @employee_id, @shift_id, 0, @tab_id, @note, @created_at)`
    );

    const chargeCreditIfNeeded = (amount: number, note: string) => {
      if (input.paymentMethod === 'credit' && input.customerId && amount > 0) {
        db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(amount, input.customerId);
        db.prepare("INSERT INTO ledger_entries (customer_id, kind, amount, note, created_at) VALUES (?, 'charge', ?, ?, ?)").run(
          input.customerId,
          amount,
          note,
          nowIso()
        );
      }
    };

    for (const s of sessions) {
      const txRow = insertTx.run({
        kind: 'unit',
        unit_id: s.unit_id,
        unit_type_id: s.unit_type_id,
        duration_minutes: s.duration_minutes,
        unit_amount: s.amount,
        cafe_amount: 0,
        total_amount: s.amount,
        payment_method: input.paymentMethod,
        customer_id: input.customerId ?? null,
        employee_id: input.employeeId ?? null,
        shift_id: input.shiftId ?? null,
        tab_id: input.tabId,
        note: input.note ?? `حساب باز «${tab.title}» — ${s.unit_name}`,
        created_at: nowIso(),
      });
      const txId = txRow.lastInsertRowid as number;
      transactionIds.push(txId);
      db.prepare('UPDATE open_tab_unit_sessions SET transaction_id = ? WHERE id = ?').run(txId, s.id);
      unitAmount += s.amount;
      chargeCreditIfNeeded(s.amount, `حساب باز «${tab.title}» — ${s.unit_name}`);
    }

    if (cafeLines.length) {
      const lineTotal = cafeLines.reduce((sum, l) => sum + l.qty * l.unit_price, 0);
      const txRow = insertTx.run({
        kind: 'cafe',
        unit_id: null,
        unit_type_id: null,
        duration_minutes: null,
        unit_amount: 0,
        cafe_amount: lineTotal,
        total_amount: lineTotal,
        payment_method: input.paymentMethod,
        customer_id: input.customerId ?? null,
        employee_id: input.employeeId ?? null,
        shift_id: input.shiftId ?? null,
        tab_id: input.tabId,
        note: input.note ?? `حساب باز «${tab.title}» — کافه`,
        created_at: nowIso(),
      });
      const txId = txRow.lastInsertRowid as number;
      transactionIds.push(txId);
      const link = db.prepare('UPDATE cafe_order_items SET transaction_id = ? WHERE id = ?');
      for (const l of cafeLines) link.run(txId, l.id);
      cafeAmount += lineTotal;
      chargeCreditIfNeeded(lineTotal, `حساب باز «${tab.title}» — کافه`);
    }

    if (input.adjustAmount) {
      if (unitAmount + cafeAmount + input.adjustAmount < 0) throw new Error('کسر مبلغ نمی‌تواند مبلغ نهایی را منفی کند');
      const adjustNoteSuffix = ` — ${input.adjustAmount > 0 ? 'مبلغ دستی' : 'کسر مبلغ'}: ${Math.abs(input.adjustAmount).toLocaleString(
        'fa-IR'
      )}${input.adjustNote ? ` (${input.adjustNote})` : ''}`;
      const txRow = insertTx.run({
        kind: 'other',
        unit_id: null,
        unit_type_id: null,
        duration_minutes: null,
        unit_amount: 0,
        cafe_amount: 0,
        total_amount: input.adjustAmount,
        payment_method: input.paymentMethod,
        customer_id: input.customerId ?? null,
        employee_id: input.employeeId ?? null,
        shift_id: input.shiftId ?? null,
        tab_id: input.tabId,
        note: `حساب باز «${tab.title}»${adjustNoteSuffix}`,
        created_at: nowIso(),
      });
      transactionIds.push(txRow.lastInsertRowid as number);
      chargeCreditIfNeeded(input.adjustAmount, `حساب باز «${tab.title}»${adjustNoteSuffix}`);
    }

    db.prepare("UPDATE open_tabs SET status = 'closed', closed_at = ? WHERE id = ?").run(nowIso(), input.tabId);

    return { transactionIds, unitAmount, cafeAmount, totalAmount: unitAmount + cafeAmount + (input.adjustAmount ?? 0) };
  })();
}

/**
 * Deletes an open tab entirely (staff created it by mistake, or want to void
 * it). Refuses if any unit is still actively playing linked to this tab —
 * that game must be ended first so its running timer isn't silently orphaned.
 * Any already-finished-but-unpaid line items on the tab (pending unit
 * sessions, pending cafe orders — nothing with a transaction_id, since
 * anything already billed belongs to a real transaction elsewhere and is
 * never touched) are removed along with it.
 */
export function deleteOpenTab(db: Database.Database, tabId: number, nowIso: () => string): void {
  db.transaction(() => {
    const tab = db.prepare('SELECT * FROM open_tabs WHERE id = ?').get(tabId) as any;
    if (!tab) throw new Error('حساب یافت نشد');
    const activeUnit = db.prepare("SELECT 1 FROM units WHERE linked_tab_id = ? AND status = 'playing'").get(tabId);
    if (activeUnit) throw new Error('این حساب یک بازی در حال انجام دارد — ابتدا بازی را پایان دهید');

    db.prepare('UPDATE units SET linked_tab_id = NULL WHERE linked_tab_id = ?').run(tabId);

    // Restore cafe stock for any pending (unbilled) items — same as removing
    // a single item — so deleting a mistaken tab doesn't quietly shrink inventory.
    const pendingCafe = db.prepare('SELECT * FROM cafe_order_items WHERE tab_id = ? AND transaction_id IS NULL').all(tabId) as any[];
    for (const line of pendingCafe) {
      db.prepare('UPDATE cafe_items SET stock = stock + ? WHERE id = ?').run(line.qty, line.cafe_item_id);
      db.prepare("INSERT INTO inventory_log (cafe_item_id, change, reason, created_at) VALUES (?, ?, 'sale', ?)").run(
        line.cafe_item_id,
        line.qty,
        nowIso()
      );
    }

    db.prepare('DELETE FROM open_tab_unit_sessions WHERE tab_id = ? AND transaction_id IS NULL').run(tabId);
    db.prepare('DELETE FROM cafe_order_items WHERE tab_id = ? AND transaction_id IS NULL').run(tabId);
    db.prepare('DELETE FROM open_tabs WHERE id = ?').run(tabId);
  })();
}

export interface TabSplitPart {
  paymentMethod: 'cash' | 'card' | 'credit' | 'cardTransfer';
  customerId?: number;
  sessionShares?: { sessionId: number; amount: number }[]; // this part's share (whole or partial) of each game session
  cafeShares?: { cafeItemId: number; amount: number }[]; // this part's share (whole or partial) of each cafe line
  adjustAmount?: number; // this part's share of any مبلغ دستی/کسر مبلغ adjustment
  adjustNote?: string;
}

export interface SplitTabCheckoutInput {
  tabId: number;
  employeeId?: number;
  shiftId?: number;
  parts: TabSplitPart[];
}

export interface SplitTabCheckoutResult {
  transactionIds: number[];
  unitAmount: number;
  cafeAmount: number;
  totalAmount: number;
  tabClosed: boolean;
}

interface SessionShareClaim {
  sessionId: number;
  amount: number;
  partIndex: number;
}

interface SessionShareRow {
  rowId: number;
  amount: number;
  unitId: number;
  unitTypeId: number;
  unitName: string;
  durationMinutes: number;
}

/** Same idea as resolveCafeShares, but for open_tab_unit_sessions rows — a single
 * game's cost can be split between several payers. duration_minutes is allocated
 * proportionally to each fragment's share of the amount (the LAST fragment absorbs
 * any rounding remainder), so summing durations across fragments still recovers
 * the original playtime — no double-counting on دشبورد "ساعت بازی امروز" and
 * similar reports. */
function resolveSessionShares(db: Database.Database, claims: SessionShareClaim[]): Map<number, SessionShareRow[]> {
  const byItem = new Map<number, SessionShareClaim[]>();
  for (const c of claims) {
    if (!byItem.has(c.sessionId)) byItem.set(c.sessionId, []);
    byItem.get(c.sessionId)!.push(c);
  }

  const byPart = new Map<number, SessionShareRow[]>();
  const pushToPart = (partIndex: number, row: SessionShareRow) => {
    if (!byPart.has(partIndex)) byPart.set(partIndex, []);
    byPart.get(partIndex)!.push(row);
  };

  for (const [sessionId, itemClaims] of byItem) {
    const row = db.prepare('SELECT * FROM open_tab_unit_sessions WHERE id = ? AND transaction_id IS NULL').get(sessionId) as any;
    if (!row) continue;

    if (itemClaims.length === 1 && itemClaims[0].amount === row.amount) {
      pushToPart(itemClaims[0].partIndex, {
        rowId: row.id,
        amount: row.amount,
        unitId: row.unit_id,
        unitTypeId: row.unit_type_id,
        unitName: row.unit_name,
        durationMinutes: row.duration_minutes,
      });
      continue;
    }

    db.prepare('DELETE FROM open_tab_unit_sessions WHERE id = ?').run(row.id);
    let durationUsed = 0;
    itemClaims.forEach((claim, idx) => {
      const fragmentDuration =
        idx === itemClaims.length - 1
          ? row.duration_minutes - durationUsed
          : row.amount > 0
            ? Math.round(row.duration_minutes * (claim.amount / row.amount))
            : 0;
      durationUsed += fragmentDuration;
      const r = db
        .prepare(
          `INSERT INTO open_tab_unit_sessions
           (tab_id, unit_id, unit_type_id, unit_kind, unit_name, duration_minutes, exact_amount, amount, started_at, ended_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(row.tab_id, row.unit_id, row.unit_type_id, row.unit_kind, row.unit_name, fragmentDuration, claim.amount, claim.amount, row.started_at, row.ended_at);
      pushToPart(claim.partIndex, {
        rowId: r.lastInsertRowid as number,
        amount: claim.amount,
        unitId: row.unit_id,
        unitTypeId: row.unit_type_id,
        unitName: row.unit_name,
        durationMinutes: fragmentDuration,
      });
    });
  }

  return byPart;
}

/**
 * Splits a tab's checkout across several payers — each game session or cafe
 * line (or a PORTION of either, e.g. دنگی on the table time) is assigned to
 * one or more parts. The tab only closes once every pending amount on it has
 * been fully assigned and billed; anything left unassigned stays pending on
 * the (still-open) tab, same as if it had never been touched.
 */
export function runSplitTabCheckout(db: Database.Database, input: SplitTabCheckoutInput, nowIso: () => string): SplitTabCheckoutResult {
  return db.transaction(() => {
    const tab = db.prepare('SELECT * FROM open_tabs WHERE id = ?').get(input.tabId) as any;
    if (!tab) throw new Error('حساب یافت نشد');
    if (tab.status !== 'open') throw new Error('این حساب قبلاً بسته شده است');

    const sessionClaims: SessionShareClaim[] = [];
    const cafeClaims: CafeShareClaim[] = [];
    input.parts.forEach((part, i) => {
      for (const s of part.sessionShares ?? []) {
        if (s.amount > 0) sessionClaims.push({ sessionId: s.sessionId, amount: s.amount, partIndex: i });
      }
      for (const c of part.cafeShares ?? []) {
        if (c.amount > 0) cafeClaims.push({ cafeItemId: c.cafeItemId, amount: c.amount, partIndex: i });
      }
    });
    const resolvedSessions = resolveSessionShares(db, sessionClaims);
    const resolvedCafe = resolveCafeShares(db, cafeClaims);

    const insertTx = db.prepare(
      `INSERT INTO transactions
       (kind, unit_id, unit_type_id, duration_minutes, unit_amount, cafe_amount, total_amount, payment_method, customer_id, employee_id, shift_id, manual_override, tab_id, note, created_at)
       VALUES (@kind, @unit_id, @unit_type_id, @duration_minutes, @unit_amount, @cafe_amount, @total_amount, @payment_method, @customer_id, @employee_id, @shift_id, 0, @tab_id, @note, @created_at)`
    );

    const chargeCreditIfNeeded = (amount: number, method: string, customerId: number | undefined, note: string) => {
      if (method === 'credit' && customerId && amount > 0) {
        db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(amount, customerId);
        db.prepare("INSERT INTO ledger_entries (customer_id, kind, amount, note, created_at) VALUES (?, 'charge', ?, ?, ?)").run(
          customerId,
          amount,
          note,
          nowIso()
        );
      }
    };

    const transactionIds: number[] = [];
    let unitAmount = 0;
    let cafeAmount = 0;
    let grandTotal = 0;

    input.parts.forEach((part, i) => {
      const sessionRows = resolvedSessions.get(i) ?? [];
      for (const s of sessionRows) {
        const txRow = insertTx.run({
          kind: 'unit',
          unit_id: s.unitId,
          unit_type_id: s.unitTypeId,
          duration_minutes: s.durationMinutes,
          unit_amount: s.amount,
          cafe_amount: 0,
          total_amount: s.amount,
          payment_method: part.paymentMethod,
          customer_id: part.customerId ?? null,
          employee_id: input.employeeId ?? null,
          shift_id: input.shiftId ?? null,
          tab_id: input.tabId,
          note: `حساب باز «${tab.title}» — ${s.unitName} (تقسیمی)`,
          created_at: nowIso(),
        });
        const txId = txRow.lastInsertRowid as number;
        transactionIds.push(txId);
        db.prepare('UPDATE open_tab_unit_sessions SET transaction_id = ? WHERE id = ?').run(txId, s.rowId);
        unitAmount += s.amount;
        grandTotal += s.amount;
        chargeCreditIfNeeded(s.amount, part.paymentMethod, part.customerId, `حساب باز «${tab.title}» — ${s.unitName}`);
      }

      const cafeRows = resolvedCafe.get(i) ?? [];
      const cafeLineTotal = cafeRows.reduce((s, r) => s + r.amount, 0);
      const adjustAmount = part.adjustAmount ?? 0;
      const extraTotal = cafeLineTotal + adjustAmount;
      if (extraTotal === 0 && cafeRows.length === 0) return;
      if (extraTotal < 0) throw new Error('کسر مبلغ نمی‌تواند سهم یک نفر را منفی کند');

      const adjustNoteSuffix = adjustAmount
        ? ` — ${adjustAmount > 0 ? 'مبلغ دستی' : 'کسر مبلغ'}: ${Math.abs(adjustAmount).toLocaleString('fa-IR')}${
            part.adjustNote ? ` (${part.adjustNote})` : ''
          }`
        : '';
      const txRow = insertTx.run({
        kind: cafeRows.length > 0 ? 'cafe' : 'other',
        unit_id: null,
        unit_type_id: null,
        duration_minutes: null,
        unit_amount: 0,
        cafe_amount: cafeLineTotal,
        total_amount: extraTotal,
        payment_method: part.paymentMethod,
        customer_id: part.customerId ?? null,
        employee_id: input.employeeId ?? null,
        shift_id: input.shiftId ?? null,
        tab_id: input.tabId,
        note: `حساب باز «${tab.title}»${cafeRows.length > 0 ? ' — کافه (تقسیمی)' : ''}${adjustNoteSuffix}`,
        created_at: nowIso(),
      });
      const txId = txRow.lastInsertRowid as number;
      transactionIds.push(txId);
      const link = db.prepare('UPDATE cafe_order_items SET transaction_id = ? WHERE id = ?');
      for (const r of cafeRows) link.run(txId, r.rowId);
      cafeAmount += cafeLineTotal;
      grandTotal += extraTotal;
      chargeCreditIfNeeded(extraTotal, part.paymentMethod, part.customerId, `حساب باز «${tab.title}»${cafeRows.length > 0 ? ' — کافه' : ''}`);
    });

    const remaining = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM open_tab_unit_sessions WHERE tab_id = ? AND transaction_id IS NULL) +
                (SELECT COUNT(*) FROM cafe_order_items WHERE tab_id = ? AND transaction_id IS NULL) as c`
      )
      .get(input.tabId, input.tabId) as { c: number };

    let tabClosed = false;
    if (remaining.c === 0) {
      db.prepare("UPDATE open_tabs SET status = 'closed', closed_at = ? WHERE id = ?").run(nowIso(), input.tabId);
      tabClosed = true;
    }

    return { transactionIds, unitAmount, cafeAmount, totalAmount: grandTotal, tabClosed };
  })();
}
