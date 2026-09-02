import { useCallback, useState } from 'react';
import { useClubEvent } from '../../lib/useClubEvent';
import './opentabs.css';

/**
 * حساب باز (Open Tab) now lives in its own separate Electron window (see
 * electron/main.ts createOpenTabsWindow) instead of a modal here, so staff
 * can leave it open on a second screen. This component only keeps a live
 * count badge in the top bar and opens/focuses that window on click.
 */
export function OpenTabsMenu() {
  const [count, setCount] = useState(0);
  const [warn, setWarn] = useState(false);

  const load = useCallback(async () => {
    const tabs = await window.api.openTabs.list();
    setCount(tabs.length);
    const s = await window.api.settings.getAll();
    const warningHours = Number(s.open_tab_warning_hours ?? 3);
    const now = Date.now();
    setWarn(tabs.some((t: any) => now - new Date(t.created_at).getTime() > warningHours * 3600_000));
  }, []);
  useClubEvent(['open_tabs', 'settings'], load);

  return (
    <button className={`topbar-tabs-btn ${warn ? 'topbar-tabs-btn-warn' : ''}`} onClick={() => window.api.openTabsWindow.open()}>
      حساب‌های باز ({count.toLocaleString('fa-IR')})
    </button>
  );
}
