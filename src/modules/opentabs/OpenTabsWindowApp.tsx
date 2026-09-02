import { useCallback, useEffect, useMemo, useState } from 'react';
import { useClubEvent } from '../../lib/useClubEvent';
import { toman, jalaliTime } from '../../lib/persian';
import { formatDuration } from '../../lib/format';
import { Button } from '../../components/Button';
import { NewTabModal } from './NewTabModal';
import { TabDetailModal } from './TabDetailModal';
import '../checkout/CheckoutModal.css';
import './opentabs.css';
import './OpenTabsWindowApp.css';

/**
 * Rendered inside its own separate Electron window (see
 * electron/main.ts createOpenTabsWindow + src/main.tsx routing) instead of
 * as a modal in the main window, so staff can leave حساب‌های باز open on a
 * second screen while working the tables/cafe in the main window.
 */
export function OpenTabsWindowApp() {
  const [tabs, setTabs] = useState<any[]>([]);
  const [warningHours, setWarningHours] = useState(3);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [shiftId, setShiftId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [newTabOpen, setNewTabOpen] = useState(false);
  const [detailTabId, setDetailTabId] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    setTabs(await window.api.openTabs.list());
    const s = await window.api.settings.getAll();
    setWarningHours(Number(s.open_tab_warning_hours ?? 3));
    const activeShifts = await window.api.shifts.active();
    if (activeShifts[0]) {
      setEmployeeId(activeShifts[0].employee_id);
      setShiftId(activeShifts[0].id);
    }
  }, []);
  useClubEvent(['open_tabs', 'settings', 'shifts'], load);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!query) return tabs;
    return tabs.filter((t) =>
      [t.title, t.customer_name, t.phone].filter(Boolean).some((f: string) => String(f).toLowerCase().includes(query))
    );
  }, [tabs, query]);

  return (
    <div className="opentabs-window">
      <div className="opentabs-window-header">
        <h1>حساب‌های باز</h1>
        <div className="opentabs-window-toolbar">
          <input
            className="checkout-input opentabs-search"
            placeholder="جستجوی نام، عنوان یا شماره…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button variant="primary" onClick={() => setNewTabOpen(true)}>
            + حساب جدید
          </Button>
        </div>
      </div>

      {filtered.length === 0 && <p className="pos-empty">حساب باز فعالی وجود ندارد</p>}

      <div className="opentabs-window-list">
        {filtered.map((t) => {
          const elapsedMs = now - new Date(t.created_at).getTime();
          const warn = elapsedMs > warningHours * 3600_000;
          return (
            <button key={t.id} className={`opentabs-row ${warn ? 'opentabs-row-warn' : ''}`} onClick={() => setDetailTabId(t.id)}>
              <div className="opentabs-row-main">
                <span className="opentabs-row-title">{t.title}</span>
                {t.customer_name && t.customer_name !== t.title && <span className="opentabs-row-sub">{t.customer_name}</span>}
              </div>
              <div className="opentabs-row-meta">
                <span>از {jalaliTime(t.created_at)}</span>
                <span>{formatDuration(elapsedMs)}</span>
                <span>{t.item_count} آیتم</span>
                <span className="opentabs-row-amount">{toman(t.grand_total)}</span>
              </div>
            </button>
          );
        })}
      </div>

      {newTabOpen && (
        <NewTabModal
          onClose={() => setNewTabOpen(false)}
          onCreated={(id) => {
            setNewTabOpen(false);
            setDetailTabId(id);
          }}
        />
      )}

      {detailTabId != null && (
        <TabDetailModal
          tabId={detailTabId}
          employeeId={employeeId}
          shiftId={shiftId}
          allTabs={tabs}
          onClose={() => setDetailTabId(null)}
          onClosedTab={() => setDetailTabId(null)}
        />
      )}
    </div>
  );
}
