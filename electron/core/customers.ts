import type Database from 'better-sqlite3';

export interface NewCustomerInput {
  name: string;
  phone?: string;
  initialDebt?: number;
}

/**
 * Creates a ledger (حساب دفتری) customer. Name uniqueness only applies to
 * customers who currently have an OPEN, unsettled balance — i.e. the ones
 * actually showing in the ledger list. A name that was settled to zero, or
 * explicitly deleted from Settings, is free to reuse; the old row (and its
 * history, for reports) is left exactly as it was.
 */
export function createCustomer(db: Database.Database, input: NewCustomerInput, nowIso: () => string): number {
  const openDuplicate = db
    .prepare('SELECT id FROM customers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND archived = 0 AND balance != 0')
    .get(input.name);
  if (openDuplicate) {
    throw new Error('این نام در حال حاضر حساب دفتری باز دارد');
  }

  return db.transaction(() => {
    const r = db
      .prepare('INSERT INTO customers (name, phone, balance) VALUES (?, ?, ?)')
      .run(input.name, input.phone ?? '', input.initialDebt ?? 0);
    const customerId = r.lastInsertRowid as number;
    if (input.initialDebt) {
      db.prepare("INSERT INTO ledger_entries (customer_id, kind, amount, note, created_at) VALUES (?, 'charge', ?, 'بدهی اولیه', ?)").run(
        customerId,
        input.initialDebt,
        nowIso()
      );
    }
    return customerId;
  })();
}
