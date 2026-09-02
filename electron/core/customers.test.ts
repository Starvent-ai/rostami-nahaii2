// @vitest-environment node
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCustomer } from './customers';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(path.join(import.meta.dirname, '../db/schema.sql'), 'utf-8');
  db.exec(schema);
  return db;
}

const nowIso = () => new Date().toISOString();

describe('createCustomer (duplicate-name rule)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
  });

  it('blocks a duplicate name while the existing customer still has an open balance', () => {
    createCustomer(db, { name: 'امیر', initialDebt: 50_000 }, nowIso);
    expect(() => createCustomer(db, { name: 'امیر' }, nowIso)).toThrow();
  });

  it('allows reusing a name once the existing customer has been settled to zero', () => {
    const firstId = createCustomer(db, { name: 'امیر', initialDebt: 50_000 }, nowIso);
    db.prepare('UPDATE customers SET balance = 0 WHERE id = ?').run(firstId);

    const secondId = createCustomer(db, { name: 'امیر' }, nowIso);
    expect(secondId).not.toBe(firstId);

    const old = db.prepare('SELECT * FROM customers WHERE id = ?').get(firstId) as any;
    expect(old).toBeDefined();
    expect(old.balance).toBe(0);
  });

  it('allows reusing a name once the existing customer has been archived (deleted from Settings)', () => {
    const firstId = createCustomer(db, { name: 'امیر', initialDebt: 50_000 }, nowIso);
    db.prepare('UPDATE customers SET archived = 1 WHERE id = ?').run(firstId);

    expect(() => createCustomer(db, { name: 'امیر' }, nowIso)).not.toThrow();
  });

  it('is case- and whitespace-insensitive when checking for an open duplicate', () => {
    createCustomer(db, { name: '  Amir  ', initialDebt: 10_000 }, nowIso);
    expect(() => createCustomer(db, { name: 'amir' }, nowIso)).toThrow();
  });
});
