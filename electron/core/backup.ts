import fs from 'node:fs';
import path from 'node:path';
import { DB_PATH, BACKUP_DIR } from '../db/index.js';

const MAX_BACKUPS = 30;

function timestamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(
    d.getMinutes()
  )}-${pad(d.getSeconds())}`;
}

/**
 * §13 — backups are NOT time-scheduled (the PC is not always on because of
 * daily outages). Instead we snapshot on every app close, plus a manual
 * "backup now" button. Copying the WAL-mode SQLite file is cheap and fast,
 * so it never delays shutdown.
 */
export function runBackup(extraDrivePath?: string): string | null {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const dest = path.join(BACKUP_DIR, `club-${timestamp()}.db`);
    fs.copyFileSync(DB_PATH, dest);

    // mirror to external drive if one is connected and path provided
    if (extraDrivePath && fs.existsSync(extraDrivePath)) {
      try {
        fs.copyFileSync(DB_PATH, path.join(extraDrivePath, `club-${timestamp()}.db`));
      } catch {
        // external drive copy is best-effort only
      }
    }

    rotate();
    return dest;
  } catch (err) {
    console.error('backup failed', err);
    return null;
  }
}

function rotate() {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('club-') && f.endsWith('.db'))
    .map((f) => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);

  for (const { f } of files.slice(MAX_BACKUPS)) {
    fs.unlinkSync(path.join(BACKUP_DIR, f));
  }
}
