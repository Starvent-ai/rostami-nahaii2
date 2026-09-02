import type Database from 'better-sqlite3';
import { calcUnitPrice, EFFECTIVE_HOURLY_RATE_SQL } from './pricing.js';
import { resolveCafeShares, type CafeShareClaim } from './cafeSplit.js';

export interface SplitPart {
  paymentMethod: 'cash' | 'card' | 'credit' | 'cardTransfer';
  customerId?: number;
  unitAmount?: number; // this part's share (whole or partial) of the unit's time cost
  cafeShares?: { cafeItemId: number; amount: number }[]; // this part's share (whole or partial) of each cafe line
  adjustAmount?: number; // this part's share of any مبلغ دستی/کسر مبلغ adjustment
  adjustNote?: string;
}

export interface SplitCheckoutInput {
  unitId: number;
  employeeId?: number;
  shiftId?: number;
  parts: SplitPart[];
}

export interface SplitCheckoutResult {
  transactionIds: number[];
  totalAmount: number;
}

/**
 * Splits ONE unit's checkout (its time cost + any cafe items already
 * attached to it) across several payers — e.g. one person pays cash for
 * their drink while another puts the table time on their حساب دفتری, and
 * either can be a PARTIAL share (a single item's amount split between
 * several people, e.g. دنگی on the table time) via cafeShares/unitAmount
 * carrying less than the item's full amount. The unit is freed exactly once
 * regardless of how many parts end up billed. Any UNassigned amount (unit or
 * cafe) is left exactly as-is (still unbilled) — the frontend is expected to
 * require every amount be fully allocated before calling this.
 */
export function runSplitCheckout(db: Database.Database, input: SplitCheckoutInput, nowIso: () => string): SplitCheckoutResult {
  return db.transaction(() => {
    const unit = db
      .prepare(
        `SELECT u.*, (${EFFECTIVE_HOURLY_RATE_SQL}) as hourly_rate FROM units u JOIN unit_types ut ON ut.id = u.unit_type_id WHERE u.id = ?`
      )
      .get(input.unitId) as any;
    if (!unit) throw new Error('unit not found');

    let durationMinutes: number | null = null;
    if (unit.start_time) {
      const elapsedMs = Date.now() - new Date(unit.start_time).getTime();
      const priced = calcUnitPrice(elapsedMs, unit.hourly_rate);
      durationMinutes = Math.round(priced.exactMinutes);
    }

    db.prepare("UPDATE units SET status = 'free', start_time = NULL, current_customer_id = NULL WHERE id = ?").run(input.unitId);

    const claims: CafeShareClaim[] = [];
    input.parts.forEach((part, i) => {
      for (const share of part.cafeShares ?? []) {
        if (share.amount > 0) claims.push({ cafeItemId: share.cafeItemId, amount: share.amount, partIndex: i });
      }
    });
    const resolved = resolveCafeShares(db, claims);

    const insertTx = db.prepare(
      `INSERT INTO transactions
       (kind, unit_id, unit_type_id, duration_minutes, unit_amount, cafe_amount, total_amount, payment_method, customer_id, employee_id, shift_id, manual_override, note, created_at)
       VALUES (@kind, @unit_id, @unit_type_id, @duration_minutes, @unit_amount, @cafe_amount, @total_amount, @payment_method, @customer_id, @employee_id, @shift_id, 0, @note, @created_at)`
    );

    const transactionIds: number[] = [];
    let grandTotal = 0;

    input.parts.forEach((part, i) => {
      const partUnitAmount = part.unitAmount ?? 0;
      const partCafeRows = resolved.get(i) ?? [];
      const partCafeAmount = partCafeRows.reduce((s, r) => s + r.amount, 0);
      const adjustAmount = part.adjustAmount ?? 0;
      const partTotal = partUnitAmount + partCafeAmount + adjustAmount;
      if (partUnitAmount === 0 && partCafeAmount === 0 && adjustAmount === 0) return;
      if (partTotal < 0) throw new Error('کسر مبلغ نمی‌تواند سهم یک نفر را منفی کند');

      const adjustNoteSuffix = adjustAmount
        ? ` — ${adjustAmount > 0 ? 'مبلغ دستی' : 'کسر مبلغ'}: ${Math.abs(adjustAmount).toLocaleString('fa-IR')}${
            part.adjustNote ? ` (${part.adjustNote})` : ''
          }`
        : '';

      const txRow = insertTx.run({
        kind: partUnitAmount > 0 ? 'unit' : partCafeAmount > 0 ? 'cafe' : 'other',
        unit_id: partUnitAmount > 0 ? input.unitId : null,
        unit_type_id: partUnitAmount > 0 ? unit.unit_type_id : null,
        duration_minutes: partUnitAmount > 0 ? durationMinutes : null,
        unit_amount: partUnitAmount,
        cafe_amount: partCafeAmount,
        total_amount: partTotal,
        payment_method: part.paymentMethod,
        customer_id: part.customerId ?? null,
        employee_id: input.employeeId ?? null,
        shift_id: input.shiftId ?? null,
        note: 'تسویه تقسیمی' + adjustNoteSuffix,
        created_at: nowIso(),
      });
      const txId = txRow.lastInsertRowid as number;
      transactionIds.push(txId);

      const link = db.prepare('UPDATE cafe_order_items SET transaction_id = ? WHERE id = ?');
      for (const r of partCafeRows) link.run(txId, r.rowId);

      if (part.paymentMethod === 'credit' && part.customerId && partTotal > 0) {
        db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(partTotal, part.customerId);
        db.prepare("INSERT INTO ledger_entries (customer_id, kind, amount, note, created_at) VALUES (?, 'charge', ?, ?, ?)").run(
          part.customerId,
          partTotal,
          'خرید نسیه (تسویه تقسیمی)',
          nowIso()
        );
      }
      grandTotal += partTotal;
    });

    return { transactionIds, totalAmount: grandTotal };
  })();
}

export interface CheckoutInput {
  unitId?: number;
  standaloneCafe?: { cafeItemId: number; qty: number }[];
  paymentMethod: 'cash' | 'card' | 'credit' | 'cardTransfer';
  customerId?: number;
  employeeId?: number;
  shiftId?: number;
  manualAmount?: number; // §11 manual override during a power outage
  // The exact/rounded unit price + duration the operator was SHOWN on the
  // پایان بازی screen (computed once when the modal opened, per the
  // checkout-modal price freeze — see CheckoutModal.tsx). When present and
  // manualAmount is not set, this is authoritative: the charge must match
  // what was displayed and confirmed, not a fresh live recomputation from
  // the unit's start_time. Without this, a delay between opening the modal
  // and clicking confirm (e.g. while filling in a split or an adjustment)
  // would silently charge a different, larger amount than what the
  // operator and customer saw and agreed to — reproduced live: a screen
  // showing 30,000 ended up billing 35,000 after a couple of minutes'
  // delay before confirming.
  confirmedUnitAmount?: number;
  confirmedExactUnitAmount?: number;
  confirmedDurationMinutes?: number;
  adjustAmount?: number; // مبلغ دستی (positive) or کسر مبلغ (negative) — added/subtracted from the total
  adjustNote?: string;
  note?: string;
}

export interface CheckoutResult {
  transactionId: number;
  unitAmount: number;
  exactUnitAmount: number | null;
  cafeAmount: number;
  totalAmount: number;
  durationMinutes: number | null;
}

/**
 * Runs a full checkout (unit time + attached cafe tab + optional standalone
 * cafe sale) as a single SQLite transaction. Takes a plain `better-sqlite3`
 * Database and a `nowIso` clock function so it can be exercised in unit
 * tests without booting Electron (see electron/core/checkout.test.ts).
 * The IPC handler in main.ts is a thin wrapper around this function plus
 * the event-bus emit() call.
 */
export function runCheckout(db: Database.Database, input: CheckoutInput, nowIso: () => string): CheckoutResult {
  return db.transaction(() => {
    let unitAmount = 0;
    let exactUnitAmount: number | null = null;
    let durationMinutes: number | null = null;
    let unitTypeId: number | null = null;

    if (input.unitId) {
      const unit = db
        .prepare(
          `SELECT u.*, (${EFFECTIVE_HOURLY_RATE_SQL}) as hourly_rate FROM units u JOIN unit_types ut ON ut.id = u.unit_type_id WHERE u.id = ?`
        )
        .get(input.unitId) as any;
      if (!unit) throw new Error('unit not found');
      unitTypeId = unit.unit_type_id;

      if (input.manualAmount != null) {
        unitAmount = input.manualAmount;
        if (unit.start_time) {
          durationMinutes = Math.round((Date.now() - new Date(unit.start_time).getTime()) / 60000);
        }
      } else if (input.confirmedUnitAmount != null) {
        // Use the frozen snapshot the operator was shown rather than
        // recomputing from real elapsed time — see the field comment above.
        unitAmount = input.confirmedUnitAmount;
        exactUnitAmount = input.confirmedExactUnitAmount ?? null;
        durationMinutes = input.confirmedDurationMinutes ?? null;
      } else if (unit.start_time) {
        const elapsedMs = Date.now() - new Date(unit.start_time).getTime();
        const priced = calcUnitPrice(elapsedMs, unit.hourly_rate);
        durationMinutes = Math.round(priced.exactMinutes);
        exactUnitAmount = priced.exactAmount;
        unitAmount = priced.roundedAmount;
      }

      db.prepare("UPDATE units SET status = 'free', start_time = NULL, current_customer_id = NULL WHERE id = ?").run(
        input.unitId
      );
    }

    const tabItems = input.unitId
      ? (db.prepare('SELECT * FROM cafe_order_items WHERE unit_id = ? AND transaction_id IS NULL').all(input.unitId) as any[])
      : [];
    let cafeAmount = tabItems.reduce((s, i) => s + i.qty * i.unit_price, 0);

    const standaloneRows: { cafeItemId: number; qty: number; price: number }[] = [];
    for (const line of input.standaloneCafe ?? []) {
      const item = db.prepare('SELECT * FROM cafe_items WHERE id = ?').get(line.cafeItemId) as any;
      if (!item) continue;
      standaloneRows.push({ cafeItemId: line.cafeItemId, qty: line.qty, price: item.price });
      cafeAmount += line.qty * item.price;
      db.prepare('UPDATE cafe_items SET stock = stock - ? WHERE id = ?').run(line.qty, line.cafeItemId);
      db.prepare("INSERT INTO inventory_log (cafe_item_id, change, reason, created_at) VALUES (?, -?, 'sale', ?)").run(
        line.cafeItemId,
        line.qty,
        nowIso()
      );
    }

    const totalAmount = unitAmount + cafeAmount + (input.adjustAmount ?? 0);
    if (totalAmount < 0) throw new Error('کسر مبلغ نمی‌تواند مبلغ نهایی را منفی کند');

    const adjustNoteSuffix = input.adjustAmount
      ? ` — ${input.adjustAmount > 0 ? 'مبلغ دستی' : 'کسر مبلغ'}: ${Math.abs(input.adjustAmount).toLocaleString('fa-IR')}${
          input.adjustNote ? ` (${input.adjustNote})` : ''
        }`
      : '';

    const txRow = db
      .prepare(
        `INSERT INTO transactions
         (kind, unit_id, unit_type_id, duration_minutes, unit_amount, cafe_amount, total_amount, payment_method, customer_id, employee_id, shift_id, manual_override, note, created_at)
         VALUES (@kind, @unit_id, @unit_type_id, @duration_minutes, @unit_amount, @cafe_amount, @total_amount, @payment_method, @customer_id, @employee_id, @shift_id, @manual_override, @note, @created_at)`
      )
      .run({
        kind: input.unitId ? 'unit' : 'cafe',
        unit_id: input.unitId ?? null,
        unit_type_id: unitTypeId,
        duration_minutes: durationMinutes,
        unit_amount: unitAmount,
        cafe_amount: cafeAmount,
        total_amount: totalAmount,
        payment_method: input.paymentMethod,
        customer_id: input.customerId ?? null,
        employee_id: input.employeeId ?? null,
        shift_id: input.shiftId ?? null,
        manual_override: input.manualAmount != null ? 1 : 0,
        note: (input.note ?? (input.manualAmount != null ? 'تسویه دستی به‌دلیل قطعی برق' : '')) + adjustNoteSuffix,
        created_at: nowIso(),
      });

    const transactionId = txRow.lastInsertRowid as number;

    if (tabItems.length) {
      const link = db.prepare('UPDATE cafe_order_items SET transaction_id = ? WHERE id = ?');
      for (const it of tabItems) link.run(transactionId, it.id);
    }
    for (const row of standaloneRows) {
      db.prepare(
        'INSERT INTO cafe_order_items (transaction_id, cafe_item_id, qty, unit_price, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(transactionId, row.cafeItemId, row.qty, row.price, nowIso());
    }

    if (input.paymentMethod === 'credit' && input.customerId) {
      db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(totalAmount, input.customerId);
      db.prepare("INSERT INTO ledger_entries (customer_id, kind, amount, note, created_at) VALUES (?, 'charge', ?, ?, ?)").run(
        input.customerId,
        totalAmount,
        input.note ?? 'خرید نسیه',
        nowIso()
      );
    }

    return { transactionId, unitAmount, exactUnitAmount, cafeAmount, totalAmount, durationMinutes };
  })();
}
