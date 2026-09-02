import { app, BrowserWindow, ipcMain, Menu, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { db, nowIso, getOrphanedPlayingUnits } from './db/index.js';
import { emit, notify } from './core/eventBus.js';
import { runBackup } from './core/backup.js';
import { createCustomer } from './core/customers.js';
import { runCheckout, runSplitCheckout, type CheckoutInput, type SplitCheckoutInput } from './core/checkout.js';
import { calcUnitPrice, EFFECTIVE_HOURLY_RATE_SQL } from './core/pricing.js';
import {
  createOpenTab,
  deleteOpenTab,
  endUnitSessionToTab,
  moveUnitCafeToTab,
  runSplitTabCheckout,
  runTabCheckout,
  type NewTabInput,
  type SplitTabCheckoutInput,
  type TabCheckoutInput,
} from './core/openTabs.js';

let mainWindow: BrowserWindow | null = null;
let openTabsWindow: BrowserWindow | null = null;

function getConfiguredBackupPath(): string | undefined {
  return (db.prepare("SELECT value FROM settings WHERE key='backup_path'").get() as any)?.value || undefined;
}

/** Finds an existing row by case/whitespace-insensitive name match — used to merge duplicate names instead of creating new records. */
function findByNameCI(table: string, name: string): { id: number } | undefined {
  return db.prepare(`SELECT id FROM ${table} WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))`).get(name) as any;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0a0a0d',
    icon: path.join(import.meta.dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(import.meta.dirname, '../dist/index.html'));
  }
}

// حساب باز (Open Tab) opens in its own separate, independently movable
// window instead of a modal in the main window, so staff can leave it open
// on a second screen while working the tables/cafe in the main window. Both
// windows share the same preload/renderer bundle and the same SQLite db —
// src/main.tsx picks which top-level app to render based on the #hash.
function createOpenTabsWindow() {
  if (openTabsWindow) {
    openTabsWindow.show();
    openTabsWindow.focus();
    return;
  }
  openTabsWindow = new BrowserWindow({
    width: 920,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#0a0a0d',
    icon: path.join(import.meta.dirname, 'icon.png'),
    title: 'حساب‌های باز',
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    openTabsWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#/opentabs-window`);
  } else {
    openTabsWindow.loadFile(path.join(import.meta.dirname, '../dist/index.html'), { hash: '/opentabs-window' });
  }

  openTabsWindow.on('closed', () => {
    openTabsWindow = null;
  });
}

ipcMain.handle('openTabsWindow:open', () => createOpenTabsWindow());

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  checkOverdueDebtorsOnBoot();
  checkLowStockOnBoot();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  runBackup(getConfiguredBackupPath()); // §13 — snapshot on close, not on a fixed schedule
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  runBackup(getConfiguredBackupPath());
});

// ============================================================
// §11 Power-outage recovery — surfaced to renderer on load
// ============================================================
ipcMain.handle('recovery:getOrphans', () => getOrphanedPlayingUnits());

// ============================================================
// Settings (§19 white-label)
// ============================================================
ipcMain.handle('settings:getAll', () => {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
});

ipcMain.handle('settings:set', (_e, key: string, value: string) => {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value
  );
  emit(['settings']);
});

// ============================================================
// Unit types (§1, §19 — generic rentable-unit types, not hardcoded)
// ============================================================
ipcMain.handle('unitTypes:list', () =>
  db.prepare('SELECT * FROM unit_types WHERE archived = 0 ORDER BY sort_order').all()
);

ipcMain.handle(
  'unitTypes:create',
  (
    _e,
    data: {
      name: string;
      kind?: 'billiard' | 'ps';
      is_pro?: boolean;
      hourly_rate?: number;
      ps_tier1_price?: number;
      ps_tier2_price?: number;
      ps_tier3_price?: number;
      ps_tier4_price?: number;
      image?: string;
      round_minutes?: number;
    }
  ) => {
    const r = db
      .prepare(
        `INSERT INTO unit_types (name, kind, is_pro, hourly_rate, ps_tier1_price, ps_tier2_price, ps_tier3_price, ps_tier4_price, image, round_minutes, sort_order)
         VALUES (@name, @kind, @is_pro, @hourly_rate, @t1, @t2, @t3, @t4, @image, @round_minutes, (SELECT COALESCE(MAX(sort_order),-1)+1 FROM unit_types))`
      )
      .run({
        name: data.name,
        kind: data.kind ?? 'billiard',
        is_pro: data.is_pro ? 1 : 0,
        hourly_rate: data.hourly_rate ?? 0,
        t1: data.ps_tier1_price ?? 0,
        t2: data.ps_tier2_price ?? 0,
        t3: data.ps_tier3_price ?? 0,
        t4: data.ps_tier4_price ?? 0,
        image: data.image ?? '',
        round_minutes: data.round_minutes ?? 15,
      });
    emit(['unit_types']);
    return r.lastInsertRowid;
  }
);

ipcMain.handle(
  'unitTypes:update',
  (
    _e,
    id: number,
    data: Partial<{
      name: string;
      hourly_rate: number;
      ps_tier1_price: number;
      ps_tier2_price: number;
      ps_tier3_price: number;
      ps_tier4_price: number;
      image: string;
      image_playing: string;
      round_minutes: number;
    }>
  ) => {
    const fields = Object.keys(data);
    if (fields.length === 0) return;
  const sql = `UPDATE unit_types SET ${fields.map((f) => `${f} = @${f}`).join(', ')} WHERE id = @id`;
  db.prepare(sql).run({ ...data, id });
  emit(['unit_types']);
});

ipcMain.handle('unitTypes:archive', (_e, id: number) => {
  db.prepare('UPDATE unit_types SET archived = 1 WHERE id = ?').run(id);
  emit(['unit_types', 'units']);
});

// ============================================================
// Units (§1 dashboard, timers) + §11 manual override
// ============================================================
ipcMain.handle('units:list', () =>
  db
    .prepare(
      `SELECT u.*, ut.name as unit_type_name, ut.kind as unit_type_kind, ut.is_pro,
              ut.ps_tier1_price, ut.ps_tier2_price, ut.ps_tier3_price, ut.ps_tier4_price,
              (${EFFECTIVE_HOURLY_RATE_SQL}) as hourly_rate, ut.round_minutes, ut.image, ut.image_playing,
              ot.title as linked_tab_title
       FROM units u JOIN unit_types ut ON ut.id = u.unit_type_id
       LEFT JOIN open_tabs ot ON ot.id = u.linked_tab_id
       WHERE u.archived = 0 ORDER BY u.sort_order`
    )
    .all()
);

ipcMain.handle('units:create', (_e, data: { unit_type_id: number; name?: string }) => {
  const type = db.prepare('SELECT * FROM unit_types WHERE id = ?').get(data.unit_type_id) as any;
  if (!type) throw new Error('unit type not found');
  const nextNumber =
    ((db.prepare('SELECT COALESCE(MAX(unit_number), 0) m FROM units WHERE unit_type_id = ?').get(data.unit_type_id) as { m: number })
      .m ?? 0) + 1;
  const name = (data.name?.trim() || type.name) + ` ${nextNumber.toLocaleString('fa-IR')}`;
  const existing = findByNameCI('units', name);
  if (existing) return existing.id; // merge: unit with this exact name already exists
  const r = db
    .prepare(
      'INSERT INTO units (name, unit_number, unit_type_id, status, sort_order) VALUES (?, ?, ?, \'free\', (SELECT COALESCE(MAX(sort_order),-1)+1 FROM units))'
    )
    .run(name, nextNumber, data.unit_type_id);
  emit(['units']);
  return r.lastInsertRowid;
});

ipcMain.handle('units:update', (_e, id: number, data: Partial<{ name: string; unit_type_id: number }>) => {
  const fields = Object.keys(data);
  if (fields.length === 0) return;
  const sql = `UPDATE units SET ${fields.map((f) => `${f} = @${f}`).join(', ')} WHERE id = @id`;
  db.prepare(sql).run({ ...data, id });
  emit(['units']);
});

ipcMain.handle('units:archive', (_e, id: number) => {
  db.prepare('UPDATE units SET archived = 1 WHERE id = ?').run(id);
  emit(['units']);
});

ipcMain.handle('units:start', (_e, unitId: number, customerId?: number, activeTiers?: number, tabId?: number) => {
  db.prepare(
    "UPDATE units SET status = 'playing', start_time = ?, current_customer_id = ?, active_tiers = ?, linked_tab_id = ? WHERE id = ?"
  ).run(nowIso(), customerId ?? null, activeTiers ?? null, tabId ?? null, unitId);
  emit(['units']);
  if (tabId) emit(['open_tabs']);
});

// Ends a game and adds it to an open tab (حساب باز): charges the exact/rounded
// amount onto the tab as a pending line item and frees the unit — no payment here,
// that happens later when the whole tab is checked out. If the unit wasn't linked
// to a tab when the game started, pass tabId explicitly to route it to one now.
ipcMain.handle('units:endToTab', (_e, unitId: number, tabId?: number) => {
  const result = endUnitSessionToTab(db, unitId, nowIso, tabId);
  emit(['units', 'open_tabs']);
  return result;
});

// Links a unit that is ALREADY playing (started normally, not from a tab) to
// an open tab mid-session — staff can decide this any time during play, not
// just at start or end. The running timer is untouched; only where the final
// charge will land changes. Any cafe orders already placed on the unit (from
// before it was linked) move onto the tab too, so nothing is left unbilled.
ipcMain.handle('units:linkToTab', (_e, unitId: number, tabId: number) => {
  const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unitId) as any;
  if (!unit) throw new Error('unit not found');
  if (unit.status !== 'playing') throw new Error('این میز/سیستم در حال بازی نیست');
  db.prepare('UPDATE units SET linked_tab_id = ? WHERE id = ?').run(tabId, unitId);
  moveUnitCafeToTab(db, unitId, tabId);
  emit(['units', 'open_tabs']);
});

ipcMain.handle('units:reserve', (_e, unitId: number) => {
  db.prepare("UPDATE units SET status = 'reserved' WHERE id = ?").run(unitId);
  emit(['units']);
});

ipcMain.handle('units:cancelReserve', (_e, unitId: number) => {
  db.prepare("UPDATE units SET status = 'free' WHERE id = ?").run(unitId);
  emit(['units']);
});

// Preview the auto-calculated amount for a currently-playing unit (used by the checkout screen)
ipcMain.handle('units:calcAmount', (_e, unitId: number) => {
  const unit = db
    .prepare(
      `SELECT u.*, (${EFFECTIVE_HOURLY_RATE_SQL}) as hourly_rate FROM units u JOIN unit_types ut ON ut.id = u.unit_type_id WHERE u.id = ?`
    )
    .get(unitId) as any;
  if (!unit || !unit.start_time) return { exactMinutes: 0, exactAmount: 0, roundedAmount: 0 };
  const elapsedMs = Date.now() - new Date(unit.start_time).getTime();
  return calcUnitPrice(elapsedMs, unit.hourly_rate);
});

// ============================================================
// Cafe menu + inventory (§2, §16)
// ============================================================
ipcMain.handle('cafeItems:list', () => db.prepare('SELECT * FROM cafe_items WHERE archived = 0 ORDER BY category, name').all());

ipcMain.handle('cafeItems:create', (_e, data: { name: string; category: string; price: number; stock: number; low_stock_threshold?: number }) => {
  const existing = findByNameCI('cafe_items', data.name);
  if (existing) {
    // Merge: same product already exists — top up its stock instead of duplicating.
    db.prepare('UPDATE cafe_items SET stock = stock + ? WHERE id = ?').run(data.stock, existing.id);
    emit(['cafe_items']);
    return existing.id;
  }
  const r = db
    .prepare('INSERT INTO cafe_items (name, category, price, stock, low_stock_threshold) VALUES (?, ?, ?, ?, ?)')
    .run(data.name, data.category, data.price, data.stock, data.low_stock_threshold ?? 5);
  emit(['cafe_items']);
  return r.lastInsertRowid;
});

ipcMain.handle('cafeItems:update', (_e, id: number, data: Partial<{ name: string; category: string; price: number; low_stock_threshold: number }>) => {
  const fields = Object.keys(data);
  if (fields.length === 0) return;
  const sql = `UPDATE cafe_items SET ${fields.map((f) => `${f} = @${f}`).join(', ')} WHERE id = @id`;
  db.prepare(sql).run({ ...data, id });
  emit(['cafe_items']);
});

ipcMain.handle('cafeItems:archive', (_e, id: number) => {
  db.prepare('UPDATE cafe_items SET archived = 1 WHERE id = ?').run(id);
  emit(['cafe_items']);
});

// ---- Cafe categories (settings-managed, each with a picked emoji) ----
ipcMain.handle('cafeCategories:list', () => db.prepare('SELECT * FROM cafe_categories ORDER BY sort_order').all());

ipcMain.handle('cafeCategories:create', (_e, name: string, emoji: string) => {
  const existing = findByNameCI('cafe_categories', name);
  if (existing) return existing.id; // merge: category already exists, reuse it
  const r = db
    .prepare('INSERT INTO cafe_categories (name, emoji, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order),-1)+1 FROM cafe_categories))')
    .run(name, emoji);
  emit(['cafe_items']);
  return r.lastInsertRowid;
});

ipcMain.handle('cafeCategories:update', (_e, id: number, data: { name?: string; emoji?: string }) => {
  const fields = Object.keys(data);
  if (fields.length === 0) return;
  db.prepare(`UPDATE cafe_categories SET ${fields.map((f) => `${f} = @${f}`).join(', ')} WHERE id = @id`).run({ ...data, id });
  emit(['cafe_items']);
});

ipcMain.handle('cafeCategories:delete', (_e, id: number) => {
  db.prepare('DELETE FROM cafe_categories WHERE id = ?').run(id);
  emit(['cafe_items']);
});

ipcMain.handle('cafeItems:restock', (_e, id: number, qty: number) => {
  const tx = db.transaction(() => {
    db.prepare('UPDATE cafe_items SET stock = stock + ? WHERE id = ?').run(qty, id);
    db.prepare('INSERT INTO inventory_log (cafe_item_id, change, reason, created_at) VALUES (?, ?, \'restock\', ?)').run(
      id,
      qty,
      nowIso()
    );
  });
  tx();
  emit(['cafe_items']);
});

// Attach a cafe order line to an open unit tab (before checkout) OR standalone (unit_id null, resolved at checkout)
ipcMain.handle('cafeOrder:addToUnit', (_e, unitId: number, cafeItemId: number, qty: number) => {
  const item = db.prepare('SELECT * FROM cafe_items WHERE id = ?').get(cafeItemId) as any;
  if (!item) throw new Error('cafe item not found');
  const tx = db.transaction(() => {
    const existing = db
      .prepare('SELECT * FROM cafe_order_items WHERE unit_id = ? AND cafe_item_id = ? AND transaction_id IS NULL')
      .get(unitId, cafeItemId) as any;
    if (existing) {
      db.prepare('UPDATE cafe_order_items SET qty = qty + ? WHERE id = ?').run(qty, existing.id);
    } else {
      db.prepare(
        'INSERT INTO cafe_order_items (unit_id, cafe_item_id, qty, unit_price, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(unitId, cafeItemId, qty, item.price, nowIso());
    }
    db.prepare('UPDATE cafe_items SET stock = stock - ? WHERE id = ?').run(qty, cafeItemId);
    db.prepare('INSERT INTO inventory_log (cafe_item_id, change, reason, created_at) VALUES (?, -?, \'sale\', ?)').run(
      cafeItemId,
      qty,
      nowIso()
    );
  });
  tx();
  emit(['cafe_order_items', 'cafe_items']);
  maybeWarnLowStock(cafeItemId);
});

// Adjust an existing tab line's quantity by a delta (+1/-1 from the UI); removes the row if it hits zero.
ipcMain.handle('cafeOrder:changeQty', (_e, id: number, delta: number) => {
  const row = db.prepare('SELECT * FROM cafe_order_items WHERE id = ?').get(id) as any;
  if (!row) return;
  const newQty = row.qty + delta;
  const tx = db.transaction(() => {
    if (newQty <= 0) {
      db.prepare('DELETE FROM cafe_order_items WHERE id = ?').run(id);
    } else {
      db.prepare('UPDATE cafe_order_items SET qty = ? WHERE id = ?').run(newQty, id);
    }
    db.prepare('UPDATE cafe_items SET stock = stock - ? WHERE id = ?').run(delta, row.cafe_item_id);
    db.prepare("INSERT INTO inventory_log (cafe_item_id, change, reason, created_at) VALUES (?, ?, 'sale', ?)").run(
      row.cafe_item_id,
      -delta,
      nowIso()
    );
  });
  tx();
  emit(['cafe_order_items', 'cafe_items']);
});

ipcMain.handle('cafeOrder:listForUnit', (_e, unitId: number) =>
  db
    .prepare(
      `SELECT coi.*, ci.name, ci.price as current_price FROM cafe_order_items coi
       JOIN cafe_items ci ON ci.id = coi.cafe_item_id
       WHERE coi.unit_id = ? AND coi.transaction_id IS NULL`
    )
    .all(unitId)
);

ipcMain.handle('cafeOrder:removeItem', (_e, id: number) => {
  db.prepare('DELETE FROM cafe_order_items WHERE id = ?').run(id);
  emit(['cafe_order_items']);
});

// ============================================================
// Cafe orders attached to an open tab (حساب باز) — mirrors cafeOrder:* for
// units above, but scoped to tab_id instead of unit_id.
// ============================================================
ipcMain.handle('openTabCafe:add', (_e, tabId: number, cafeItemId: number, qty: number) => {
  const item = db.prepare('SELECT * FROM cafe_items WHERE id = ?').get(cafeItemId) as any;
  if (!item) throw new Error('cafe item not found');
  const tx = db.transaction(() => {
    const existing = db
      .prepare('SELECT * FROM cafe_order_items WHERE tab_id = ? AND cafe_item_id = ? AND transaction_id IS NULL')
      .get(tabId, cafeItemId) as any;
    if (existing) {
      db.prepare('UPDATE cafe_order_items SET qty = qty + ? WHERE id = ?').run(qty, existing.id);
    } else {
      db.prepare(
        'INSERT INTO cafe_order_items (tab_id, cafe_item_id, qty, unit_price, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(tabId, cafeItemId, qty, item.price, nowIso());
    }
    db.prepare('UPDATE cafe_items SET stock = stock - ? WHERE id = ?').run(qty, cafeItemId);
    db.prepare("INSERT INTO inventory_log (cafe_item_id, change, reason, created_at) VALUES (?, -?, 'sale', ?)").run(
      cafeItemId,
      qty,
      nowIso()
    );
  });
  tx();
  emit(['open_tabs', 'cafe_items']);
  maybeWarnLowStock(cafeItemId);
});

ipcMain.handle('openTabCafe:changeQty', (_e, id: number, delta: number) => {
  const row = db.prepare('SELECT * FROM cafe_order_items WHERE id = ?').get(id) as any;
  if (!row) return;
  const newQty = row.qty + delta;
  const tx = db.transaction(() => {
    if (newQty <= 0) {
      db.prepare('DELETE FROM cafe_order_items WHERE id = ?').run(id);
    } else {
      db.prepare('UPDATE cafe_order_items SET qty = ? WHERE id = ?').run(newQty, id);
    }
    db.prepare('UPDATE cafe_items SET stock = stock - ? WHERE id = ?').run(delta, row.cafe_item_id);
    db.prepare("INSERT INTO inventory_log (cafe_item_id, change, reason, created_at) VALUES (?, ?, 'sale', ?)").run(
      row.cafe_item_id,
      -delta,
      nowIso()
    );
  });
  tx();
  emit(['open_tabs', 'cafe_items']);
});

// Simple cart-style listing (mirrors cafeOrder:listForUnit) for a unit's own
// cafe-order popup when that unit is linked to an open tab.
ipcMain.handle('openTabCafe:listForTab', (_e, tabId: number) =>
  db
    .prepare(
      `SELECT coi.*, ci.name, ci.price as current_price FROM cafe_order_items coi
       JOIN cafe_items ci ON ci.id = coi.cafe_item_id
       WHERE coi.tab_id = ? AND coi.transaction_id IS NULL`
    )
    .all(tabId)
);

ipcMain.handle('openTabCafe:updatePrice', (_e, id: number, unitPrice: number) => {
  db.prepare('UPDATE cafe_order_items SET unit_price = ? WHERE id = ?').run(unitPrice, id);
  emit(['open_tabs']);
});

ipcMain.handle('openTabCafe:remove', (_e, id: number) => {
  const row = db.prepare('SELECT * FROM cafe_order_items WHERE id = ?').get(id) as any;
  if (!row) return;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM cafe_order_items WHERE id = ?').run(id);
    db.prepare('UPDATE cafe_items SET stock = stock + ? WHERE id = ?').run(row.qty, row.cafe_item_id);
    db.prepare("INSERT INTO inventory_log (cafe_item_id, change, reason, created_at) VALUES (?, ?, 'sale', ?)").run(
      row.cafe_item_id,
      row.qty,
      nowIso()
    );
  });
  tx();
  emit(['open_tabs', 'cafe_items']);
});

ipcMain.handle('openTabCafe:transfer', (_e, id: number, toTabId: number) => {
  db.prepare('UPDATE cafe_order_items SET tab_id = ? WHERE id = ?').run(toTabId, id);
  emit(['open_tabs']);
});

// Moves cafe orders still attached directly to a unit (from before it was
// linked to a tab) onto the tab — used when staff decide at checkout time to
// send a normally-started game to an open tab instead of paying immediately.
ipcMain.handle('openTabCafe:adoptFromUnit', (_e, tabId: number, unitId: number) => {
  moveUnitCafeToTab(db, unitId, tabId);
  emit(['open_tabs', 'cafe_order_items']);
});

// ============================================================
// Unit (billiard/PS) game sessions charged to an open tab (حساب باز)
// ============================================================
ipcMain.handle('openTabSessions:remove', (_e, id: number) => {
  db.prepare('DELETE FROM open_tab_unit_sessions WHERE id = ? AND transaction_id IS NULL').run(id);
  emit(['open_tabs']);
});

ipcMain.handle('openTabSessions:updateAmount', (_e, id: number, amount: number) => {
  db.prepare('UPDATE open_tab_unit_sessions SET amount = ? WHERE id = ? AND transaction_id IS NULL').run(amount, id);
  emit(['open_tabs']);
});

ipcMain.handle('openTabSessions:transfer', (_e, id: number, toTabId: number) => {
  db.prepare('UPDATE open_tab_unit_sessions SET tab_id = ? WHERE id = ? AND transaction_id IS NULL').run(toTabId, id);
  emit(['open_tabs']);
});

// ============================================================
// Open tabs (حساب باز مشتری) — running customer tab across cafe orders +
// unit game sessions, checked out together at the end.
// ============================================================
ipcMain.handle('openTabs:list', () =>
  db
    .prepare(
      `SELECT ot.*,
              COALESCE(cafe.total, 0) as cafe_total,
              COALESCE(units.total, 0) as unit_total,
              COALESCE(cafe.total, 0) + COALESCE(units.total, 0) as grand_total,
              COALESCE(cafe.cnt, 0) + COALESCE(units.cnt, 0) as item_count
       FROM open_tabs ot
       LEFT JOIN (
         SELECT tab_id, SUM(qty * unit_price) as total, COUNT(*) as cnt
         FROM cafe_order_items WHERE tab_id IS NOT NULL AND transaction_id IS NULL GROUP BY tab_id
       ) cafe ON cafe.tab_id = ot.id
       LEFT JOIN (
         SELECT tab_id, SUM(amount) as total, COUNT(*) as cnt
         FROM open_tab_unit_sessions WHERE transaction_id IS NULL GROUP BY tab_id
       ) units ON units.tab_id = ot.id
       WHERE ot.status = 'open'
       ORDER BY ot.created_at ASC`
    )
    .all()
);

ipcMain.handle('openTabs:create', (_e, data: NewTabInput) => {
  const id = createOpenTab(db, data, nowIso);
  emit(['open_tabs']);
  return id;
});

ipcMain.handle('openTabs:update', (_e, id: number, data: Partial<{ title: string; customerName: string; phone: string; guestCount: number; note: string }>) => {
  const map: Record<string, string> = { title: 'title', customerName: 'customer_name', phone: 'phone', guestCount: 'guest_count', note: 'note' };
  const fields = Object.keys(data).filter((k) => k in map);
  if (fields.length === 0) return;
  const setSql = fields.map((f) => `${map[f]} = @${f}`).join(', ');
  db.prepare(`UPDATE open_tabs SET ${setSql} WHERE id = @id`).run({ ...data, id });
  emit(['open_tabs']);
});

// Deletes an open tab outright (e.g. it was created by mistake). Blocked
// while a game is still actively linked to it; any other pending (unbilled)
// items are discarded along with the tab.
ipcMain.handle('openTabs:delete', (_e, id: number) => {
  deleteOpenTab(db, id, nowIso);
  emit(['open_tabs', 'units']);
});

// Full timeline for a tab's detail view: cafe lines + unit sessions merged and sorted by time, plus subtotals.
ipcMain.handle('openTabs:get', (_e, id: number) => {
  const tab = db.prepare('SELECT * FROM open_tabs WHERE id = ?').get(id) as any;
  if (!tab) return null;

  const cafeLines = db
    .prepare(
      `SELECT coi.id, 'cafe' as kind, ci.name as description, coi.qty, coi.unit_price,
              (coi.qty * coi.unit_price) as amount, coi.created_at, ci.category as category_emoji_source
       FROM cafe_order_items coi JOIN cafe_items ci ON ci.id = coi.cafe_item_id
       WHERE coi.tab_id = ? AND coi.transaction_id IS NULL`
    )
    .all(id) as any[];

  const sessions = db
    .prepare(
      `SELECT id, 'unit' as kind, unit_name as description, 1 as qty, amount as unit_price, amount,
              ended_at as created_at, unit_kind
       FROM open_tab_unit_sessions
       WHERE tab_id = ? AND transaction_id IS NULL`
    )
    .all(id) as any[];

  const items = [...cafeLines, ...sessions].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const cafeTotal = cafeLines.reduce((s, l) => s + l.amount, 0);
  const billiardTotal = sessions.filter((s) => s.unit_kind === 'billiard').reduce((s, l) => s + l.amount, 0);
  const psTotal = sessions.filter((s) => s.unit_kind === 'ps').reduce((s, l) => s + l.amount, 0);
  const total = cafeTotal + billiardTotal + psTotal;

  return { tab, items, totals: { cafeTotal, billiardTotal, psTotal, unitTotal: billiardTotal + psTotal, total } };
});

ipcMain.handle('openTabs:checkout', (_e, input: TabCheckoutInput) => {
  const wasZero =
    input.paymentMethod === 'credit' && input.customerId
      ? (db.prepare('SELECT balance FROM customers WHERE id = ?').get(input.customerId) as any)?.balance === 0
      : false;

  const result = runTabCheckout(db, input, nowIso);

  if (input.paymentMethod === 'credit' && input.customerId && wasZero) {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(input.customerId) as any;
    notify('بدهکار جدید', `${c.name} در حساب دفتری بدهکار شد`, 'warning');
  }

  emit(['transactions', 'units', 'customers', 'cafe_order_items', 'cafe_items', 'open_tabs']);
  return result;
});

// Splits a tab's checkout across several payers — see runSplitTabCheckout.
ipcMain.handle('openTabs:checkoutSplit', (_e, input: SplitTabCheckoutInput) => {
  const result = runSplitTabCheckout(db, input, nowIso);
  emit(['transactions', 'units', 'customers', 'cafe_order_items', 'cafe_items', 'open_tabs']);
  return result;
});

function maybeWarnLowStock(cafeItemId: number) {
  const item = db.prepare('SELECT * FROM cafe_items WHERE id = ?').get(cafeItemId) as any;
  if (item && item.stock <= item.low_stock_threshold) {
    notify('اتمام موجودی', `موجودی «${item.name}» به ${item.stock} عدد رسیده است`, 'warning');
  }
}

// ============================================================
// Customers / ledger (§4, §5) — customers are only created from Settings
// ============================================================
ipcMain.handle('customers:list', () => db.prepare('SELECT * FROM customers WHERE archived = 0 ORDER BY name').all());

ipcMain.handle('customers:create', (_e, data: { name: string; phone?: string; initialDebt?: number }) => {
  const result = createCustomer(db, data, nowIso);
  emit(['customers']);
  return result;
});

// Unified debt history: charges (credit sales + advances) and payments, newest first.
ipcMain.handle('customers:history', (_e, customerId: number) =>
  db.prepare(`SELECT * FROM ledger_entries WHERE customer_id = ? ORDER BY created_at DESC`).all(customerId)
);

// overdue debtors: balance > 0 AND (last_settled_at is null OR older than N days)
ipcMain.handle('customers:overdue', (_e, days: number) => {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  return db
    .prepare(
      `SELECT * FROM customers WHERE balance > 0 AND (last_settled_at IS NULL OR last_settled_at < ?) ORDER BY balance DESC`
    )
    .all(cutoff);
});

// Removing a ledger customer from Settings — soft-deleted (archived) rather
// than hard-deleted so past transactions/ledger history referencing them
// stay intact; they simply stop appearing anywhere a customer can be picked.
ipcMain.handle('customers:delete', (_e, id: number) => {
  db.prepare('UPDATE customers SET archived = 1 WHERE id = ?').run(id);
  emit(['customers']);
});

function clearHistoryIfSettled(customerId: number) {
  const c = db.prepare('SELECT balance FROM customers WHERE id = ?').get(customerId) as any;
  if (c && c.balance <= 0) {
    db.prepare('UPDATE customers SET balance = 0 WHERE id = ?').run(customerId);
    db.prepare('DELETE FROM ledger_entries WHERE customer_id = ?').run(customerId);
  }
}

ipcMain.handle('ledger:addPayment', (_e, customerId: number, amount: number, note?: string) => {
  const tx = db.transaction(() => {
    db.prepare('INSERT INTO ledger_payments (customer_id, amount, created_at, note) VALUES (?, ?, ?, ?)').run(
      customerId,
      amount,
      nowIso(),
      note ?? ''
    );
    db.prepare("INSERT INTO ledger_entries (customer_id, kind, amount, note, created_at) VALUES (?, 'payment', ?, ?, ?)").run(
      customerId,
      amount,
      note ?? '',
      nowIso()
    );
    db.prepare('UPDATE customers SET balance = balance - ?, last_settled_at = ? WHERE id = ?').run(
      amount,
      nowIso(),
      customerId
    );
    clearHistoryIfSettled(customerId);
  });
  tx();
  emit(['customers']);
});

// "پرداخت باشگاه": the club advances cash to someone, who then owes the club that amount.
ipcMain.handle('ledger:addAdvance', (_e, customerId: number, amount: number, note?: string) => {
  const tx = db.transaction(() => {
    db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(amount, customerId);
    db.prepare("INSERT INTO ledger_entries (customer_id, kind, amount, note, created_at) VALUES (?, 'advance', ?, ?, ?)").run(
      customerId,
      amount,
      note ?? 'پرداخت باشگاه',
      nowIso()
    );
  });
  tx();
  emit(['customers']);
});

// ============================================================
// Employees / shifts (§6, §7)
// ============================================================
ipcMain.handle('employees:list', () => db.prepare('SELECT * FROM employees WHERE active = 1 ORDER BY name').all());

ipcMain.handle('employees:create', (_e, name: string) => {
  const existing = findByNameCI('employees', name);
  if (existing) return existing.id; // merge: employee with this name already exists
  const r = db.prepare('INSERT INTO employees (name) VALUES (?)').run(name);
  emit(['employees']);
  return r.lastInsertRowid;
});

// Soft-delete (active=0) so past shifts/transactions still show their name correctly.
ipcMain.handle('employees:delete', (_e, id: number) => {
  db.prepare('UPDATE employees SET active = 0 WHERE id = ?').run(id);
  emit(['employees']);
});

ipcMain.handle('shifts:checkIn', (_e, employeeId: number) => {
  const r = db.prepare('INSERT INTO shifts (employee_id, check_in) VALUES (?, ?)').run(employeeId, nowIso());
  emit(['shifts']);
  return r.lastInsertRowid;
});

ipcMain.handle('shifts:checkOut', (_e, shiftId: number) => {
  db.prepare('UPDATE shifts SET check_out = ? WHERE id = ?').run(nowIso(), shiftId);
  emit(['shifts']);
});

ipcMain.handle('shifts:active', () =>
  db
    .prepare(
      `SELECT s.*, e.name as employee_name FROM shifts s JOIN employees e ON e.id = s.employee_id WHERE s.check_out IS NULL ORDER BY s.check_in DESC`
    )
    .all()
);

ipcMain.handle('shifts:report', (_e, from: string, to: string) =>
  db
    .prepare(
      `SELECT e.name as employee_name, s.id as shift_id, s.check_in, s.check_out,
              COALESCE(SUM(t.total_amount), 0) as revenue, COUNT(t.id) as tx_count
       FROM shifts s
       JOIN employees e ON e.id = s.employee_id
       LEFT JOIN transactions t ON t.shift_id = s.id AND t.created_at BETWEEN ? AND ?
       WHERE s.check_in BETWEEN ? AND ?
       GROUP BY s.id ORDER BY s.check_in DESC`
    )
    .all(from, to, from, to)
);

// ============================================================
// Checkout / transactions (§3, §10, §11 manual override)
// ============================================================
ipcMain.handle('checkout:run', (_e, input: CheckoutInput) => {
  const wasZero =
    input.paymentMethod === 'credit' && input.customerId
      ? (db.prepare('SELECT balance FROM customers WHERE id = ?').get(input.customerId) as any)?.balance === 0
      : false;

  const result = runCheckout(db, input, nowIso);

  if (input.paymentMethod === 'credit' && input.customerId && wasZero) {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(input.customerId) as any;
    notify('بدهکار جدید', `${c.name} در حساب دفتری بدهکار شد`, 'warning');
  }

  emit(['transactions', 'units', 'customers', 'cafe_order_items', 'cafe_items']);
  return result;
});

// Splits ONE unit's checkout (time cost + attached cafe items) across
// several payers — دنگی/جدا حساب کردن. See runSplitCheckout for the rules.
ipcMain.handle('checkout:runSplit', (_e, input: SplitCheckoutInput) => {
  const result = runSplitCheckout(db, input, nowIso);
  emit(['transactions', 'units', 'customers', 'cafe_order_items', 'cafe_items']);
  return result;
});

// ============================================================
// Accounting / reports (§7, §15)
// ============================================================

// Detailed, per-transaction log for حسابداری: who registered it, when
// (ساعت + تاریخ شمسی handled client-side from created_at), which shift,
// payment method, and description — plus a category (بیلیارد/PS/کافه).
ipcMain.handle('transactions:list', (_e, from: string, to: string) =>
  db
    .prepare(
      `SELECT t.*, e.name as employee_name, s.check_in as shift_check_in,
              CASE WHEN t.kind = 'cafe' THEN 'کافه'
                   WHEN ut.kind = 'ps' THEN 'PS'
                   WHEN ut.kind = 'billiard' THEN 'بیلیارد'
                   ELSE 'سایر' END as category
       FROM transactions t
       LEFT JOIN employees e ON e.id = t.employee_id
       LEFT JOIN unit_types ut ON ut.id = t.unit_type_id
       LEFT JOIN shifts s ON s.id = t.shift_id
       WHERE t.created_at BETWEEN ? AND ?
       ORDER BY t.created_at DESC`
    )
    .all(from, to)
);

ipcMain.handle('reports:range', (_e, from: string, to: string) => {
  const totals = db
    .prepare(
      `SELECT
        COALESCE(SUM(t.unit_amount),0) as unit_revenue,
        COALESCE(SUM(t.cafe_amount),0) as cafe_revenue,
        COALESCE(SUM(t.total_amount),0) as total_revenue,
        COALESCE(SUM(CASE WHEN ut.kind='billiard' THEN t.unit_amount ELSE 0 END),0) as billiard_revenue,
        COALESCE(SUM(CASE WHEN ut.kind='ps' THEN t.unit_amount ELSE 0 END),0) as ps_revenue,
        COALESCE(SUM(CASE WHEN t.payment_method='cash' THEN t.total_amount ELSE 0 END),0) as cash,
        COALESCE(SUM(CASE WHEN t.payment_method='card' THEN t.total_amount ELSE 0 END),0) as card,
        COALESCE(SUM(CASE WHEN t.payment_method='cardTransfer' THEN t.total_amount ELSE 0 END),0) as cardTransfer,
        COALESCE(SUM(CASE WHEN t.payment_method='credit' THEN t.total_amount ELSE 0 END),0) as credit
       FROM transactions t LEFT JOIN unit_types ut ON ut.id = t.unit_type_id
       WHERE t.created_at BETWEEN ? AND ?`
    )
    .get(from, to) as any;

  const expenseTotal = (
    db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE created_at BETWEEN ? AND ?`).get(from, to) as any
  ).total;
  totals.expense_total = expenseTotal;
  totals.profit = totals.total_revenue - expenseTotal;

  const byUnitType = db
    .prepare(
      `SELECT ut.name, COALESCE(SUM(t.unit_amount),0) as revenue
       FROM unit_types ut LEFT JOIN transactions t ON t.unit_type_id = ut.id AND t.created_at BETWEEN ? AND ?
       GROUP BY ut.id ORDER BY revenue DESC`
    )
    .all(from, to);

  const byHour = db
    .prepare(
      `SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
       FROM transactions WHERE created_at BETWEEN ? AND ? GROUP BY hour ORDER BY hour`
    )
    .all(from, to);

  const topCafeItems = db
    .prepare(
      `SELECT ci.name, SUM(coi.qty) as qty
       FROM cafe_order_items coi JOIN cafe_items ci ON ci.id = coi.cafe_item_id
       WHERE coi.created_at BETWEEN ? AND ?
       GROUP BY ci.id ORDER BY qty DESC LIMIT 5`
    )
    .all(from, to);

  const busiestUnits = db
    .prepare(
      `SELECT u.name, COALESCE(SUM(t.total_amount),0) as revenue, COALESCE(SUM(t.duration_minutes),0) as minutes
       FROM units u LEFT JOIN transactions t ON t.unit_id = u.id AND t.created_at BETWEEN ? AND ?
       GROUP BY u.id ORDER BY revenue DESC LIMIT 5`
    )
    .all(from, to);

  const topCustomer = db
    .prepare(
      `SELECT c.name, SUM(t.total_amount) as total_spent
       FROM transactions t JOIN customers c ON c.id = t.customer_id
       WHERE t.created_at BETWEEN ? AND ?
       GROUP BY c.id ORDER BY total_spent DESC LIMIT 1`
    )
    .get(from, to);

  const invoiceCounts = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN t.kind='unit' AND ut.kind='billiard' THEN 1 ELSE 0 END),0) as billiard,
        COALESCE(SUM(CASE WHEN t.kind='unit' AND ut.kind='ps' THEN 1 ELSE 0 END),0) as ps,
        COALESCE(SUM(CASE WHEN t.kind='cafe' THEN 1 ELSE 0 END),0) as cafe
       FROM transactions t LEFT JOIN unit_types ut ON ut.id = t.unit_type_id
       WHERE t.created_at BETWEEN ? AND ?`
    )
    .get(from, to);
  totals.total_play_minutes = (
    db
      .prepare(`SELECT COALESCE(SUM(duration_minutes),0) as total FROM transactions WHERE kind='unit' AND created_at BETWEEN ? AND ?`)
      .get(from, to) as any
  ).total;

  return { totals, byUnitType, byHour, topCafeItems, busiestUnits, topCustomer, invoiceCounts };
});

// 7-day revenue trend (dashboard line chart) — always the trailing 7 days regardless of the dashboard's own date filter.
ipcMain.handle('reports:last7Days', () => {
  const days: { date: string; revenue: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date();
    day.setDate(day.getDate() - i);
    const from = new Date(day.getFullYear(), day.getMonth(), day.getDate()).toISOString();
    const to = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999).toISOString();
    const revenue = (
      db.prepare('SELECT COALESCE(SUM(total_amount),0) as total FROM transactions WHERE created_at BETWEEN ? AND ?').get(from, to) as any
    ).total;
    days.push({ date: from, revenue });
  }
  return days;
});

// Closed open-tab visits within a range: entry/exit time, stay duration, item
// count, cafe vs game totals — گزارش‌ها section for حساب باز.
ipcMain.handle('reports:tabVisits', (_e, from: string, to: string) =>
  db
    .prepare(
      `SELECT ot.id, ot.title, ot.customer_name, ot.guest_count, ot.created_at as entered_at, ot.closed_at as exited_at,
              CAST((julianday(ot.closed_at) - julianday(ot.created_at)) * 24 * 60 AS INTEGER) as duration_minutes,
              (SELECT COUNT(*) FROM cafe_order_items WHERE tab_id = ot.id) +
              (SELECT COUNT(*) FROM open_tab_unit_sessions WHERE tab_id = ot.id) as item_count,
              COALESCE((SELECT SUM(qty * unit_price) FROM cafe_order_items WHERE tab_id = ot.id), 0) as cafe_total,
              COALESCE((SELECT SUM(amount) FROM open_tab_unit_sessions WHERE tab_id = ot.id), 0) as unit_total
       FROM open_tabs ot
       WHERE ot.status = 'closed' AND ot.closed_at BETWEEN ? AND ?
       ORDER BY ot.closed_at DESC`
    )
    .all(from, to)
);

// ============================================================
// Simple stock inventory (موجودی‌ها) — independent from کافه و بوفه catalog
// ============================================================
ipcMain.handle('stockItems:list', () => db.prepare('SELECT * FROM stock_items WHERE archived = 0 ORDER BY name').all());

ipcMain.handle('stockItems:create', (_e, data: { name: string; unit_label: string; quantity: number; low_stock_threshold?: number }) => {
  const r = db
    .prepare('INSERT INTO stock_items (name, unit_label, quantity, low_stock_threshold) VALUES (?, ?, ?, ?)')
    .run(data.name, data.unit_label, data.quantity, data.low_stock_threshold ?? 5);
  emit(['stock_items']);
  return r.lastInsertRowid;
});

ipcMain.handle('stockItems:update', (_e, id: number, data: Partial<{ name: string; unit_label: string; quantity: number; low_stock_threshold: number }>) => {
  const fields = Object.keys(data);
  if (fields.length === 0) return;
  db.prepare(`UPDATE stock_items SET ${fields.map((f) => `${f} = @${f}`).join(', ')} WHERE id = @id`).run({ ...data, id });
  emit(['stock_items']);
  const item = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(id) as any;
  if (item && item.quantity <= item.low_stock_threshold) {
    notify('اتمام موجودی', `موجودی «${item.name}» به ${item.quantity} ${item.unit_label} رسیده است`, 'warning');
  }
});

ipcMain.handle('stockItems:archive', (_e, id: number) => {
  db.prepare('UPDATE stock_items SET archived = 1 WHERE id = ?').run(id);
  emit(['stock_items']);
});

// ============================================================
// Expenses (حسابداری → هزینه‌ها)
// ============================================================
ipcMain.handle('expenses:list', (_e, from: string, to: string) =>
  db.prepare('SELECT * FROM expenses WHERE created_at BETWEEN ? AND ? ORDER BY created_at DESC').all(from, to)
);

ipcMain.handle('expenses:create', (_e, data: { category: string; amount: number; description?: string; employeeId?: number }) => {
  const r = db
    .prepare('INSERT INTO expenses (category, amount, description, employee_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(data.category, data.amount, data.description ?? '', data.employeeId ?? null, nowIso());
  emit(['transactions']);
  return r.lastInsertRowid;
});

// ============================================================
// Settings PIN lock (تنظیمات section lock, numeric 4+ digits)
// ============================================================
ipcMain.handle('settingsPin:check', (_e, pin: string) => {
  const hash = (db.prepare("SELECT value FROM settings WHERE key='settings_pin_hash'").get() as any)?.value ?? '';
  if (!hash) return true; // no PIN set yet → unlocked
  return hashPin(pin) === hash;
});

ipcMain.handle('settingsPin:isSet', () => {
  const hash = (db.prepare("SELECT value FROM settings WHERE key='settings_pin_hash'").get() as any)?.value ?? '';
  return !!hash;
});

ipcMain.handle('settingsPin:set', (_e, pin: string) => {
  db.prepare("INSERT INTO settings (key, value) VALUES ('settings_pin_hash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    hashPin(pin)
  );
});

ipcMain.handle('settingsPin:clear', () => {
  db.prepare("INSERT INTO settings (key, value) VALUES ('settings_pin_hash', '') ON CONFLICT(key) DO UPDATE SET value = ''").run();
});

// ============================================================
// Reports/Accounting PIN lock (حسابداری و گزارش‌ها pages lock,
// numeric 4+ digits) — separate PIN from the تنظیمات lock above,
// same hashing scheme, stored under its own settings key so the two
// locks are independent (e.g. staff who can view reports but
// shouldn't open Settings, or vice versa).
// ============================================================
ipcMain.handle('reportsPin:check', (_e, pin: string) => {
  const hash = (db.prepare("SELECT value FROM settings WHERE key='reports_pin_hash'").get() as any)?.value ?? '';
  if (!hash) return true; // no PIN set yet → unlocked
  return hashPin(pin) === hash;
});

ipcMain.handle('reportsPin:isSet', () => {
  const hash = (db.prepare("SELECT value FROM settings WHERE key='reports_pin_hash'").get() as any)?.value ?? '';
  return !!hash;
});

ipcMain.handle('reportsPin:set', (_e, pin: string) => {
  db.prepare("INSERT INTO settings (key, value) VALUES ('reports_pin_hash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    hashPin(pin)
  );
});

ipcMain.handle('reportsPin:clear', () => {
  db.prepare("INSERT INTO settings (key, value) VALUES ('reports_pin_hash', '') ON CONFLICT(key) DO UPDATE SET value = ''").run();
});

function hashPin(pin: string): string {
  // Lightweight obfuscation for a staff-level access PIN (not a security-critical secret).
  let h = 0;
  for (let i = 0; i < pin.length; i++) h = (h * 31 + pin.charCodeAt(i)) >>> 0;
  return `${pin.length}:${h}`;
}

// ============================================================
// Tournaments (§8 — minimal modular MVP)
// ============================================================
ipcMain.handle('tournaments:list', () => db.prepare('SELECT * FROM tournaments ORDER BY created_at DESC').all());

ipcMain.handle('tournaments:create', (_e, title: string, type: 'billiard' | 'playstation') => {
  const r = db.prepare("INSERT INTO tournaments (title, type, status, created_at) VALUES (?, ?, 'open', ?)").run(
    title,
    type,
    nowIso()
  );
  emit(['tournaments']);
  return r.lastInsertRowid;
});

ipcMain.handle('tournaments:addParticipant', (_e, tournamentId: number, name: string) => {
  db.prepare('INSERT INTO tournament_participants (tournament_id, name) VALUES (?, ?)').run(tournamentId, name);
  emit(['tournaments']);
});

ipcMain.handle('tournaments:participants', (_e, tournamentId: number) =>
  db.prepare('SELECT * FROM tournament_participants WHERE tournament_id = ?').all(tournamentId)
);

ipcMain.handle('tournaments:eliminate', (_e, participantId: number) => {
  db.prepare('UPDATE tournament_participants SET eliminated = 1 WHERE id = ?').run(participantId);
  emit(['tournaments']);
});

ipcMain.handle('tournaments:setStatus', (_e, id: number, status: string, winner?: string) => {
  db.prepare('UPDATE tournaments SET status = ?, winner = ? WHERE id = ?').run(status, winner ?? null, id);
  emit(['tournaments']);
});

// ============================================================
// Backup
// ============================================================
ipcMain.handle('backup:runNow', (_e, extraDrivePath?: string) => runBackup(extraDrivePath || getConfiguredBackupPath()));

ipcMain.handle('backup:pickFolder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  const chosen = result.filePaths[0];
  db.prepare("INSERT INTO settings (key, value) VALUES ('backup_path', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    chosen
  );
  emit(['settings']);
  return chosen;
});

// ============================================================
// PDF export (گزارش‌ها → خروجی PDF) — uses Electron's built-in
// printToPDF against the currently-rendered Reports page, no extra deps.
// ============================================================
ipcMain.handle('reports:exportPdf', async () => {
  if (!mainWindow) return null;
  const pdfBuffer = await mainWindow.webContents.printToPDF({
    landscape: false,
    printBackground: true,
    pageSize: 'A4',
    margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
  });
  const clubName = (db.prepare("SELECT value FROM settings WHERE key='club_name'").get() as any)?.value || 'club';
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `گزارش-${clubName}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, pdfBuffer);
  return result.filePath;
});

// ============================================================
// Boot-time checks → in-app notifications (§18)
// ============================================================
function checkOverdueDebtorsOnBoot() {
  const days = Number((db.prepare("SELECT value FROM settings WHERE key='overdue_days_warning'").get() as any)?.value ?? 15);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const overdue = db
    .prepare(`SELECT COUNT(*) c FROM customers WHERE balance > 0 AND (last_settled_at IS NULL OR last_settled_at < ?)`)
    .get(cutoff) as any;
  if (overdue.c > 0) {
    notify('بدهکاران دیرکرد', `${overdue.c} مشتری بیش از ${days} روز بدهی تسویه‌نشده دارند`, 'warning');
  }
}

function checkLowStockOnBoot() {
  const low = db.prepare('SELECT name FROM cafe_items WHERE archived = 0 AND stock <= low_stock_threshold').all() as any[];
  for (const item of low) {
    notify('اتمام موجودی', `موجودی «${item.name}» رو به اتمام است`, 'warning');
  }
}
