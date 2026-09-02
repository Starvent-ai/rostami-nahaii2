import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const userDataDir = app.getPath('userData');
if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

export const DB_PATH = path.join(userDataDir, 'club.db');
export const BACKUP_DIR = path.join(userDataDir, 'backups');

export const db = new Database(DB_PATH);
// §11 — power outage resilience: WAL mode survives sudden power loss without corruption
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

const schemaPath = path.join(app.isPackaged ? process.resourcesPath : path.join(import.meta.dirname), 'schema.sql');
const schemaSql = fs.readFileSync(
  fs.existsSync(schemaPath) ? schemaPath : path.join(import.meta.dirname, 'schema.sql'),
  'utf-8'
);
db.exec(schemaSql);

// ===== Defensive migration: add any new columns to a DB created by an
// earlier version of the app (CREATE TABLE IF NOT EXISTS above does not
// retroactively add columns to an already-existing table). =====
function ensureColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn('unit_types', 'kind', "kind TEXT NOT NULL DEFAULT 'billiard'");
ensureColumn('unit_types', 'is_pro', 'is_pro INTEGER NOT NULL DEFAULT 0');
ensureColumn('unit_types', 'ps_tier1_price', 'ps_tier1_price INTEGER NOT NULL DEFAULT 0');
ensureColumn('unit_types', 'ps_tier2_price', 'ps_tier2_price INTEGER NOT NULL DEFAULT 0');
ensureColumn('unit_types', 'ps_tier3_price', 'ps_tier3_price INTEGER NOT NULL DEFAULT 0');
ensureColumn('unit_types', 'ps_tier4_price', 'ps_tier4_price INTEGER NOT NULL DEFAULT 0');
ensureColumn('units', 'active_tiers', 'active_tiers INTEGER');
ensureColumn('units', 'linked_tab_id', 'linked_tab_id INTEGER');
ensureColumn('transactions', 'tab_id', 'tab_id INTEGER');
ensureColumn('cafe_order_items', 'tab_id', 'tab_id INTEGER');
ensureColumn('customers', 'archived', 'archived INTEGER NOT NULL DEFAULT 0');
ensureColumn('units', 'unit_number', 'unit_number INTEGER');
ensureColumn('unit_types', 'image_playing', 'image_playing TEXT');

// These two indexes reference tab_id, which the migration above may have
// just added to a pre-existing table — must run after ensureColumn, never
// inside schema.sql's unconditional exec (see note in schema.sql).
db.exec('CREATE INDEX IF NOT EXISTS idx_tx_tab ON transactions(tab_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_cafe_order_tab ON cafe_order_items(tab_id)');

function nowIso() {
  return new Date().toISOString();
}

/** Inserts a settings default only if the key is missing — used to add new settings to DBs created by an earlier app version. */
function ensureSetting(key: string, value: string) {
  const exists = db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key);
  if (!exists) db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

// ===== First-run seed: default branding + Artuor's unit types (fully editable later) =====
function seedIfEmpty() {
  const settingsCount = (db.prepare('SELECT COUNT(*) c FROM settings').get() as { c: number }).c;
  if (settingsCount === 0) {
    const defaults: Record<string, string> = {
      club_name: 'آرتور',
      club_logo: '',
      overdue_days_warning: '15',
      overdue_days_critical: '30',
      open_tab_warning_hours: '3',
      receipt_printing_enabled: '0',
      pro_billiard_visible: '0',
      settings_pin_hash: '',
      backup_path: '',
    };
    const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    const tx = db.transaction(() => {
      for (const [k, v] of Object.entries(defaults)) insert.run(k, v);
    });
    tx();
  }

  const typeCount = (db.prepare('SELECT COUNT(*) c FROM unit_types').get() as { c: number }).c;
  if (typeCount === 0) {
    const insertType = db.prepare(
      `INSERT INTO unit_types (name, kind, is_pro, hourly_rate, ps_tier1_price, ps_tier2_price, ps_tier3_price, ps_tier4_price, round_minutes, sort_order)
       VALUES (@name, @kind, @is_pro, @hourly_rate, @t1, @t2, @t3, @t4, @round_minutes, @sort_order)`
    );
    const insertUnit = db.prepare(
      'INSERT INTO units (name, unit_number, unit_type_id, status, sort_order) VALUES (?, ?, ?, ?, ?)'
    );
    const tx = db.transaction(() => {
      const billiard = insertType.run({
        name: 'میز بیلیارد',
        kind: 'billiard',
        is_pro: 0,
        hourly_rate: 180000,
        t1: 0,
        t2: 0,
        t3: 0,
        t4: 0,
        round_minutes: 15,
        sort_order: 0,
      }).lastInsertRowid as number;
      const ps4 = insertType.run({
        name: 'PS4',
        kind: 'ps',
        is_pro: 0,
        hourly_rate: 0,
        t1: 30000,
        t2: 25000,
        t3: 20000,
        t4: 15000,
        round_minutes: 15,
        sort_order: 1,
      }).lastInsertRowid as number;
      insertType.run({
        name: 'PS5',
        kind: 'ps',
        is_pro: 0,
        hourly_rate: 0,
        t1: 30000,
        t2: 25000,
        t3: 20000,
        t4: 15000,
        round_minutes: 15,
        sort_order: 2,
      });
      insertUnit.run('میز بیلیارد ۱', 1, billiard, 'free', 0);
      insertUnit.run('میز بیلیارد ۲', 2, billiard, 'free', 1);
      insertUnit.run('PS4 ۱', 1, ps4, 'free', 2);
      insertUnit.run('PS4 ۲', 2, ps4, 'free', 3);
    });
    tx();
  }

  // ===== Rename an old-style "PS" unit type to "PS4" and add a "PS5" type
  // alongside it — for installs upgrading from before PS4/PS5 existed as
  // separate types. Runs every startup but only acts once (idempotent). =====
  const legacyPs = db.prepare("SELECT id FROM unit_types WHERE kind = 'ps' AND name = 'PS'").get() as
    | { id: number }
    | undefined;
  if (legacyPs) {
    db.prepare("UPDATE unit_types SET name = 'PS4' WHERE id = ?").run(legacyPs.id);
  }
  const hasPs5 = db.prepare("SELECT 1 FROM unit_types WHERE kind = 'ps' AND name = 'PS5'").get();
  const anyPs = db.prepare("SELECT * FROM unit_types WHERE kind = 'ps' ORDER BY sort_order LIMIT 1").get() as any;
  if (!hasPs5 && anyPs) {
    const maxSort = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) m FROM unit_types').get() as { m: number }).m;
    db.prepare(
      `INSERT INTO unit_types (name, kind, is_pro, hourly_rate, ps_tier1_price, ps_tier2_price, ps_tier3_price, ps_tier4_price, round_minutes, sort_order)
       VALUES ('PS5', 'ps', 0, 0, ?, ?, ?, ?, ?, ?)`
    ).run(anyPs.ps_tier1_price, anyPs.ps_tier2_price, anyPs.ps_tier3_price, anyPs.ps_tier4_price, anyPs.round_minutes, maxSort + 1);
  }

  // ===== The "پرو" billiard tier was removed as a concept — archive any
  // pro-billiard unit type (and any physical tables of that type) left over
  // from installs that had it enabled. Runs every startup, idempotent. =====
  db.prepare("UPDATE units SET archived = 1 WHERE unit_type_id IN (SELECT id FROM unit_types WHERE kind = 'billiard' AND is_pro = 1)").run();
  db.prepare("UPDATE unit_types SET archived = 1 WHERE kind = 'billiard' AND is_pro = 1").run();

  const catCount = (db.prepare('SELECT COUNT(*) c FROM cafe_categories').get() as { c: number }).c;
  if (catCount === 0) {
    const insertCat = db.prepare('INSERT INTO cafe_categories (name, emoji, sort_order) VALUES (?, ?, ?)');
    const tx = db.transaction(() => {
      insertCat.run('نوشیدنی گرم', '☕', 0);
      insertCat.run('نوشیدنی سرد', '🥤', 1);
      insertCat.run('نوشیدنی یخچال', '🧊', 2);
      insertCat.run('ساندویچ', '🥪', 3);
      insertCat.run('کیک', '🍰', 4);
    });
    tx();
  }

  const cafeCount = (db.prepare('SELECT COUNT(*) c FROM cafe_items').get() as { c: number }).c;
  if (cafeCount === 0) {
    const insertItem = db.prepare(
      'INSERT INTO cafe_items (name, category, price, stock, low_stock_threshold) VALUES (?, ?, ?, ?, ?)'
    );
    const tx = db.transaction(() => {
      insertItem.run('اسپرسو', 'نوشیدنی گرم', 45000, 50, 10);
      insertItem.run('کاپوچینو', 'نوشیدنی گرم', 55000, 50, 10);
      insertItem.run('کیک شکلاتی', 'کیک', 65000, 20, 5);
      insertItem.run('نوشابه', 'نوشیدنی سرد', 30000, 60, 12);
      insertItem.run('ساندویچ مرغ', 'ساندویچ', 120000, 15, 4);
      insertItem.run('آب معدنی یخچال', 'نوشیدنی یخچال', 20000, 40, 10);
      insertItem.run('ماءالشعیر یخچال', 'نوشیدنی یخچال', 35000, 30, 8);
    });
    tx();
  }

  const stockCount = (db.prepare('SELECT COUNT(*) c FROM stock_items').get() as { c: number }).c;
  if (stockCount === 0) {
    const insertStock = db.prepare(
      'INSERT INTO stock_items (name, unit_label, quantity, low_stock_threshold) VALUES (?, ?, ?, ?)'
    );
    const tx = db.transaction(() => {
      insertStock.run('نوشابه', 'عدد', 32, 10);
      insertStock.run('قهوه', 'گرم', 580, 100);
      insertStock.run('آب معدنی', 'عدد', 40, 10);
    });
    tx();
  }

  // Deliberately NOT seeding a sample employee: the personnel gate must stay
  // hidden until the club actually defines staff in Settings.
}
seedIfEmpty();
ensureSetting('open_tab_warning_hours', '3');

// ===== §11 recovery: on boot, surface any unit left "playing" through a power outage =====
export function getOrphanedPlayingUnits() {
  return db
    .prepare(
      `SELECT u.*, ut.name as unit_type_name, ut.hourly_rate
       FROM units u JOIN unit_types ut ON ut.id = u.unit_type_id
       WHERE u.status = 'playing' AND u.start_time IS NOT NULL`
    )
    .all();
}

export { nowIso };
