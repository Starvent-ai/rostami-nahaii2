import { useMemo, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { toman, jalaliTime } from '../../lib/persian';
import { formatDuration } from '../../lib/format';
import '../checkout/CheckoutModal.css';
import './opentabs.css';

export function OpenTabsListModal({
  tabs,
  warningHours,
  now,
  onClose,
  onOpenNew,
  onOpenDetail,
}: {
  tabs: any[];
  warningHours: number;
  now: number;
  onClose: () => void;
  onOpenNew: () => void;
  onOpenDetail: (id: number) => void;
}) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!query) return tabs;
    return tabs.filter((t) =>
      [t.title, t.customer_name, t.phone].filter(Boolean).some((f: string) => String(f).toLowerCase().includes(query))
    );
  }, [tabs, query]);

  return (
    <Modal title="حساب‌های باز" onClose={onClose} width={560}>
      <div className="opentabs-list-toolbar">
        <input
          className="checkout-input opentabs-search"
          placeholder="جستجوی نام، عنوان یا شماره…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button variant="primary" size="sm" onClick={onOpenNew}>
          + حساب جدید
        </Button>
      </div>

      {filtered.length === 0 && <p className="pos-empty">حساب باز فعالی وجود ندارد</p>}

      <div className="opentabs-list">
        {filtered.map((t) => {
          const elapsedMs = now - new Date(t.created_at).getTime();
          const warn = elapsedMs > warningHours * 3600_000;
          return (
            <button key={t.id} className={`opentabs-row ${warn ? 'opentabs-row-warn' : ''}`} onClick={() => onOpenDetail(t.id)}>
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
    </Modal>
  );
}
