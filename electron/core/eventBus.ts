import { BrowserWindow } from 'electron';

export type ClubEvent =
  | 'units'
  | 'unit_types'
  | 'transactions'
  | 'customers'
  | 'cafe_items'
  | 'cafe_order_items'
  | 'employees'
  | 'shifts'
  | 'settings'
  | 'tournaments'
  | 'stock_items'
  | 'expenses'
  | 'open_tabs'
  | 'notification';

/**
 * Every module writes through the DB layer and then calls emit() with the
 * domains it touched. All renderer windows receive a push event instead of
 * polling — this is the "single source of truth, no refresh needed" layer
 * required by spec §10 and the plugin/event-bus architecture required by §17.
 */
export function emit(domains: ClubEvent[], payload?: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('club:event', { domains, payload, at: Date.now() });
  }
}

export function notify(title: string, body: string, level: 'info' | 'warning' | 'danger' = 'info') {
  emit(['notification'], { title, body, level });
}
