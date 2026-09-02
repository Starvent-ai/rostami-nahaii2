import './Sidebar.css';

export type ModuleKey =
  | 'dashboard'
  | 'units'
  | 'cafe'
  | 'accounting'
  | 'reports'
  | 'ledger'
  | 'settings';

const NAV: { key: ModuleKey; label: string; icon: string }[] = [
  { key: 'dashboard', label: 'داشبورد مدیریتی', icon: '◆' },
  { key: 'units', label: 'میزها و سیستم‌ها', icon: '▦' },
  { key: 'cafe', label: 'کافه و بوفه', icon: '☕' },
  { key: 'accounting', label: 'حسابداری', icon: '฿' },
  { key: 'reports', label: 'گزارش‌ها', icon: '📊' },
  { key: 'ledger', label: 'حساب دفتری', icon: '✎' },
  { key: 'settings', label: 'تنظیمات', icon: '⚙' },
];

export function Sidebar({
  active,
  onChange,
}: {
  active: ModuleKey;
  onChange: (m: ModuleKey) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-logo">★</div>
        <div>
          <div className="sidebar-club">کلاب آرتور</div>
          <div className="sidebar-powered">Starvent</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {NAV.map((item) => (
          <button
            key={item.key}
            className={`sidebar-item ${active === item.key ? 'active' : ''}`}
            onClick={() => onChange(item.key)}
          >
            <span className="sidebar-icon">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
