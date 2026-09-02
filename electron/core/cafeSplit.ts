import type Database from 'better-sqlite3';

export interface CafeShareClaim {
  cafeItemId: number;
  amount: number;
  partIndex: number;
}

/**
 * Resolves a set of {cafeItemId, amount, partIndex} claims — where several
 * parts (payers) may each claim a portion of the SAME cafe_order_items row's
 * amount (e.g. one coffee split between two people) — into per-part billable
 * rows. When a row has exactly one claim covering its full amount, the
 * original row is reused as-is (the common, non-split case). Otherwise the
 * original row is deleted and replaced with one new qty=1 row per claim, each
 * holding that claim's amount — so each fragment can be billed under its own
 * transaction/payment method while the sum across fragments still matches
 * the original line's total (and therefore inventory/reporting stays correct).
 */
export function resolveCafeShares(db: Database.Database, claims: CafeShareClaim[]): Map<number, { rowId: number; amount: number }[]> {
  const byItem = new Map<number, CafeShareClaim[]>();
  for (const c of claims) {
    if (!byItem.has(c.cafeItemId)) byItem.set(c.cafeItemId, []);
    byItem.get(c.cafeItemId)!.push(c);
  }

  const byPart = new Map<number, { rowId: number; amount: number }[]>();
  const pushToPart = (partIndex: number, rowId: number, amount: number) => {
    if (!byPart.has(partIndex)) byPart.set(partIndex, []);
    byPart.get(partIndex)!.push({ rowId, amount });
  };

  for (const [cafeItemId, itemClaims] of byItem) {
    const row = db.prepare('SELECT * FROM cafe_order_items WHERE id = ? AND transaction_id IS NULL').get(cafeItemId) as any;
    if (!row) continue; // already billed or removed since the frontend loaded — skip silently

    const rowTotal = row.qty * row.unit_price;
    if (itemClaims.length === 1 && itemClaims[0].amount === rowTotal) {
      pushToPart(itemClaims[0].partIndex, row.id, rowTotal);
      continue;
    }

    db.prepare('DELETE FROM cafe_order_items WHERE id = ?').run(row.id);
    for (const claim of itemClaims) {
      const r = db
        .prepare('INSERT INTO cafe_order_items (unit_id, tab_id, cafe_item_id, qty, unit_price, created_at) VALUES (?, ?, ?, 1, ?, ?)')
        .run(row.unit_id, row.tab_id, row.cafe_item_id, claim.amount, row.created_at);
      pushToPart(claim.partIndex, r.lastInsertRowid as number, claim.amount);
    }
  }

  return byPart;
}
