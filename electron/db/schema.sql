-- Starvent Club Manager — Core Schema
-- Every "rentable unit" is generic (not hardcoded to billiard/PS) so the product
-- is white-label / multi-tenant ready (spec §19).

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- ===== Branding / white-label settings (§19) =====
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ===== Unit types (§1/§19 §"very important" simplification) =====
-- kind: 'billiard' | 'ps'. Billiard has one hourly_rate (or a "pro" variant,
-- a separate is_pro=1 row, only shown on the main page when the
-- pro_billiard_visible setting is on). PS systems have 4 selectable
-- "دسته" (tiers) with CUMULATIVE hourly pricing — selecting N tiers sums
-- the first N tier prices; hourly_rate is unused for kind='ps'.
CREATE TABLE IF NOT EXISTS unit_types (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,           -- e.g. "میز بیلیارد" or "PS"
  kind         TEXT NOT NULL DEFAULT 'billiard', -- 'billiard' | 'ps'
  is_pro       INTEGER NOT NULL DEFAULT 0,
  hourly_rate  INTEGER NOT NULL DEFAULT 0, -- تومان — billiard only
  ps_tier1_price INTEGER NOT NULL DEFAULT 0,
  ps_tier2_price INTEGER NOT NULL DEFAULT 0,
  ps_tier3_price INTEGER NOT NULL DEFAULT 0,
  ps_tier4_price INTEGER NOT NULL DEFAULT 0,
  image        TEXT,                    -- data URL or file path — shown for the type's units while free/reserved
  image_playing TEXT,                    -- optional data URL shown instead, while a unit of this type is playing (falls back to `image` if unset)
  round_minutes INTEGER NOT NULL DEFAULT 15,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  archived     INTEGER NOT NULL DEFAULT 0
);

-- ===== Rentable units (individual tables/systems) §1 =====
CREATE TABLE IF NOT EXISTS units (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,          -- e.g. "میز بیلیارد ۲" or "PS4 ۱" — full display name
  unit_number   INTEGER,                -- the "۱" part, kept separately so the UI can show it as its own badge next to the type name
  unit_type_id  INTEGER NOT NULL REFERENCES unit_types(id),
  status        TEXT NOT NULL DEFAULT 'free', -- free | playing | reserved
  start_time    TEXT,                   -- ISO — persisted the instant play starts (§11)
  active_tiers  INTEGER,                -- PS only: how many دسته (1-4) selected for the current session
  current_customer_id INTEGER REFERENCES customers(id),
  linked_tab_id INTEGER REFERENCES open_tabs(id), -- set while this session's cost is destined for an open tab (حساب باز) instead of an immediate checkout
  archived      INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

-- ===== Employees / shifts §6 =====
CREATE TABLE IF NOT EXISTS employees (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL,
  active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS shifts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER NOT NULL REFERENCES employees(id),
  check_in     TEXT NOT NULL,
  check_out    TEXT
);

-- ===== Customers / ledger (نسیه) §4 =====
CREATE TABLE IF NOT EXISTS customers (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL,
  phone    TEXT,
  balance  INTEGER NOT NULL DEFAULT 0,   -- current debt, تومان
  last_settled_at TEXT,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ledger_payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  amount       INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  note         TEXT
);

-- Unified debt history feed for the ledger customer detail view: every
-- charge (credit sale or club advance) and every payment, so a customer's
-- full history can be shown with date+time and payments highlighted green.
-- Cleared (not the customer row — just these entries) once fully settled.
CREATE TABLE IF NOT EXISTS ledger_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  kind         TEXT NOT NULL, -- 'charge' | 'payment' | 'advance'
  amount       INTEGER NOT NULL,
  note         TEXT,
  created_at   TEXT NOT NULL
);

-- ===== Cafe categories (§ settings-managed, each with a picked emoji) =====
CREATE TABLE IF NOT EXISTS cafe_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  emoji      TEXT NOT NULL DEFAULT '☕',
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ===== Cafe menu / inventory §2 / §16 =====
CREATE TABLE IF NOT EXISTS cafe_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  price       INTEGER NOT NULL,
  stock       INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  archived    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inventory_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cafe_item_id INTEGER NOT NULL REFERENCES cafe_items(id),
  change      INTEGER NOT NULL,   -- negative = sale, positive = restock
  reason      TEXT NOT NULL,      -- 'sale' | 'restock'
  created_at  TEXT NOT NULL
);

-- ===== Transactions: single source of truth for accounting (§10) =====
-- kind: 'unit' | 'cafe'   payment_method: 'cash' | 'card' | 'credit'
CREATE TABLE IF NOT EXISTS transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kind            TEXT NOT NULL,
  unit_id         INTEGER REFERENCES units(id),
  unit_type_id    INTEGER REFERENCES unit_types(id),
  duration_minutes INTEGER,
  unit_amount     INTEGER NOT NULL DEFAULT 0,
  cafe_amount     INTEGER NOT NULL DEFAULT 0,
  total_amount    INTEGER NOT NULL,
  payment_method  TEXT NOT NULL,
  customer_id     INTEGER REFERENCES customers(id),
  employee_id     INTEGER REFERENCES employees(id),
  shift_id        INTEGER REFERENCES shifts(id),
  manual_override INTEGER NOT NULL DEFAULT 0,  -- §11 outage manual entry
  tab_id          INTEGER REFERENCES open_tabs(id), -- set when this transaction was produced by closing an open tab (حساب باز)
  note            TEXT,
  created_at      TEXT NOT NULL
);

-- Cafe order line items belonging to a transaction (or a still-open unit tab / open tab)
CREATE TABLE IF NOT EXISTS cafe_order_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER REFERENCES transactions(id),
  unit_id        INTEGER REFERENCES units(id), -- set while attached to an open unit, before checkout
  tab_id         INTEGER REFERENCES open_tabs(id), -- set while attached to an open customer tab (حساب باز), before tab checkout
  cafe_item_id   INTEGER NOT NULL REFERENCES cafe_items(id),
  qty            INTEGER NOT NULL,
  unit_price     INTEGER NOT NULL,
  created_at     TEXT NOT NULL
);

-- ===== Tournaments §8 (kept modular / minimal for MVP) =====
CREATE TABLE IF NOT EXISTS tournaments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  type       TEXT NOT NULL,   -- 'billiard' | 'playstation'
  status     TEXT NOT NULL DEFAULT 'open', -- open | running | finished
  winner     TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tournament_participants (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id  INTEGER NOT NULL REFERENCES tournaments(id),
  name           TEXT NOT NULL,
  eliminated     INTEGER NOT NULL DEFAULT 0
);

-- ===== Open tabs (حساب باز مشتری) — a running customer tab that can collect
-- cafe orders and unit (billiard/PS) game sessions across hours, closed with
-- one combined checkout at the end. §"افزودن قابلیت حساب باز مشتری" =====
CREATE TABLE IF NOT EXISTS open_tabs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,          -- custom title, or auto "مهمان N" if nothing was entered
  customer_name TEXT,
  phone         TEXT,
  guest_count   INTEGER,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'open', -- open | closed
  created_at    TEXT NOT NULL,
  closed_at     TEXT
);

-- A finished unit (billiard/PS) game session that was charged to an open tab
-- instead of an immediate checkout. Kept even after the tab closes, for
-- reporting — transaction_id is filled in once the tab is checked out.
CREATE TABLE IF NOT EXISTS open_tab_unit_sessions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tab_id            INTEGER NOT NULL REFERENCES open_tabs(id),
  unit_id           INTEGER NOT NULL REFERENCES units(id),
  unit_type_id      INTEGER REFERENCES unit_types(id),
  unit_kind         TEXT NOT NULL, -- 'billiard' | 'ps' — denormalized for fast tab subtotals
  unit_name         TEXT NOT NULL,
  duration_minutes  INTEGER NOT NULL,
  exact_amount      INTEGER NOT NULL,
  amount            INTEGER NOT NULL, -- rounded to nearest 5,000 تومان — same rule as normal checkout
  started_at        TEXT NOT NULL,
  ended_at          TEXT NOT NULL,
  transaction_id    INTEGER REFERENCES transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_tx_shift ON transactions(shift_id);
CREATE INDEX IF NOT EXISTS idx_tx_customer ON transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_cafe_order_unit ON cafe_order_items(unit_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_customer ON ledger_entries(customer_id);
CREATE INDEX IF NOT EXISTS idx_open_tabs_status ON open_tabs(status);
CREATE INDEX IF NOT EXISTS idx_open_tab_sessions_tab ON open_tab_unit_sessions(tab_id);
-- NOTE: indexes on transactions(tab_id) and cafe_order_items(tab_id) are
-- created in db/index.ts AFTER the tab_id migration below runs, not here —
-- on a database created by an earlier app version, transactions/cafe_order_items
-- already exist without tab_id, and CREATE INDEX on a nonexistent column
-- fails immediately (unlike CREATE TABLE IF NOT EXISTS, which just no-ops).

-- ===== Expenses (حسابداری → هزینه‌ها) =====
CREATE TABLE IF NOT EXISTS expenses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT NOT NULL, -- خرید | تعمیرات دستگاه‌ها | تعمیرات/تغییرات میزها | تعمیرات/تغییرات کلاب | اجاره | آب/برق/گاز | سایر
  amount      INTEGER NOT NULL,
  description TEXT,
  employee_id INTEGER REFERENCES employees(id),
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expenses_created ON expenses(created_at);

-- ===== Simple stock inventory (موجودی‌ها — یخچالی/بوفه/نوشیدنی‌ها), independent of کافه و بوفه sales catalog =====
CREATE TABLE IF NOT EXISTS stock_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,   -- e.g. "نوشابه"
  unit_label          TEXT NOT NULL DEFAULT 'عدد', -- e.g. "عدد", "گرم"
  quantity            INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  archived            INTEGER NOT NULL DEFAULT 0
);
