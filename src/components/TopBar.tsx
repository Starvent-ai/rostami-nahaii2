import { useEffect, useState } from 'react';
import { jalaliLongDate, jalaliTime } from '../lib/persian';
import { OpenTabsMenu } from '../modules/opentabs/OpenTabsMenu';
import './TopBar.css';

export function TopBar({ employeeName }: { employeeName: string | null }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="app-topbar">
      <div className="app-topbar-employee">
        <span className="app-topbar-employee-dot" />
        {employeeName ?? 'شیفت باز نیست'}
      </div>
      <div className="app-topbar-center">
        <OpenTabsMenu />
      </div>
      <div className="app-topbar-clock">
        {jalaliLongDate(now)} — {jalaliTime(now)}
      </div>
    </div>
  );
}
