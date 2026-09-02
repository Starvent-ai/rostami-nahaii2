import { useCallback, useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import type { ModuleKey } from './components/Sidebar';
import { ToastHost } from './components/ToastHost';
import { SplashScreen } from './components/SplashScreen';
import { PersonnelGate } from './components/PersonnelGate';
import { TopBar } from './components/TopBar';
import { CheckoutModal } from './modules/checkout/CheckoutModal';
import { UnitsPage } from './modules/units/UnitsPage';
import { CafeBuffetPage } from './modules/cafe/CafeBuffetPage';
import { LedgerPage } from './modules/ledger/LedgerPage';
import { AccountingPage } from './modules/accounting/AccountingPage';
import { ReportsPage } from './modules/reports/ReportsPage';
import { DashboardPage } from './modules/dashboard/DashboardPage';
import { SettingsPage } from './modules/settings/SettingsPage';
import { useStore } from './store/useStore';
import { jalaliTime } from './lib/persian';
import './App.css';

function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [active, setActive] = useState<ModuleKey>('units');
  const [orphans, setOrphans] = useState<any[]>([]);
  const [resolveOrphan, setResolveOrphan] = useState<any | null>(null);

  const activeShiftId = useStore((s) => s.activeShiftId);
  const activeEmployeeId = useStore((s) => s.activeEmployeeId);
  const activeEmployeeName = useStore((s) => s.activeEmployeeName);

  const loadOrphans = useCallback(async () => {
    setOrphans(await window.api.recovery.getOrphans());
  }, []);
  // Only re-check orphans once at boot — a unit only needs outage recovery
  // once, right after the app (re)starts, not on every ordinary status change.
  useEffect(() => {
    loadOrphans();
  }, [loadOrphans]);

  if (showSplash) {
    return <SplashScreen onDone={() => setShowSplash(false)} />;
  }

  return (
    <>
      <PersonnelGate />

      <div className="app-shell">
        <main className="app-main">
          <TopBar employeeName={activeEmployeeName} />

          {orphans.length > 0 && (
            <div className="outage-banner">
              <span>
                ⚠ {orphans.length} میز/سیستم از قبل از قطعی برق روشن مانده — وضعیت این بازی‌ها را مشخص کنید.
              </span>
              <div className="outage-banner-list">
                {orphans.map((o) => (
                  <button key={o.id} className="outage-banner-item" onClick={() => setResolveOrphan(o)}>
                    {o.name} — از ساعت {jalaliTime(o.start_time)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="app-content">
            {active === 'dashboard' && <DashboardPage />}
            {active === 'units' && <UnitsPage activeShiftId={activeShiftId} activeEmployeeId={activeEmployeeId} />}
            {active === 'cafe' && <CafeBuffetPage employeeId={activeEmployeeId} shiftId={activeShiftId} />}
            {active === 'ledger' && <LedgerPage />}
            {active === 'accounting' && <AccountingPage />}
            {active === 'reports' && <ReportsPage />}
            {active === 'settings' && <SettingsPage />}
          </div>
        </main>

        <Sidebar active={active} onChange={setActive} />

        <ToastHost />

        {resolveOrphan && (
          <CheckoutModal
            unit={resolveOrphan}
            employeeId={activeEmployeeId}
            shiftId={activeShiftId}
            onClose={() => {
              setResolveOrphan(null);
              setOrphans((prev) => prev.filter((o) => o.id !== resolveOrphan.id));
            }}
          />
        )}
      </div>
    </>
  );
}

export default App;
