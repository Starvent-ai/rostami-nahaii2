import { useState } from 'react';
import { useClubEvent } from '../../lib/useClubEvent';
import { toman } from '../../lib/persian';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import '../checkout/CheckoutModal.css';
import './opentabs.css';

type Step = 'choose' | 'new' | 'existing';

/**
 * Shared "پیدا کردن یا ساختن یک حساب باز" flow: choose new-vs-existing, then
 * either a short new-tab form (just نام + توضیحات — kept deliberately minimal)
 * or a searchable pick list, and resolves to a tabId via onResolved. The
 * caller decides what happens next (start a game, link a playing unit, etc.).
 */
export function ChooseTabFlow({
  headerTitle,
  onResolved,
  onCancel,
}: {
  headerTitle: string;
  onResolved: (tabId: number) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>('choose');
  const [tabs, setTabs] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [note, setNote] = useState('');
  const [working, setWorking] = useState(false);

  const load = async () => setTabs(await window.api.openTabs.list());
  useClubEvent(['open_tabs'], load);

  async function createAndResolve() {
    setWorking(true);
    try {
      const id = await window.api.openTabs.create({ customerName: customerName.trim() || undefined, note: note.trim() || undefined });
      await onResolved(id);
    } finally {
      setWorking(false);
    }
  }

  async function pickExisting(id: number) {
    setWorking(true);
    try {
      await onResolved(id);
    } finally {
      setWorking(false);
    }
  }

  const query = search.trim().toLowerCase();
  const filteredTabs = query
    ? tabs.filter((t) => [t.title, t.customer_name].filter(Boolean).some((f: string) => String(f).toLowerCase().includes(query)))
    : tabs;

  if (step === 'choose') {
    return (
      <Modal title={headerTitle} onClose={onCancel} width={400}>
        <div className="opentabs-start-choice">
          <button onClick={() => setStep('new')}>+ ایجاد حساب جدید</button>
          <button onClick={() => setStep('existing')}>اتصال به حساب باز موجود</button>
        </div>
        <div className="checkout-actions">
          <Button variant="ghost" onClick={onCancel}>
            انصراف
          </Button>
        </div>
      </Modal>
    );
  }

  if (step === 'new') {
    return (
      <Modal title="حساب جدید" onClose={onCancel} width={400}>
        <input
          className="checkout-input"
          placeholder="نام مشتری (اختیاری)"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
        />
        <textarea
          className="checkout-input opentabs-note"
          placeholder="توضیحات (اختیاری)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
        />
        <div className="checkout-actions">
          <Button variant="primary" disabled={working} onClick={createAndResolve}>
            ایجاد
          </Button>
          <Button variant="ghost" onClick={() => setStep('choose')}>
            بازگشت
          </Button>
        </div>
      </Modal>
    );
  }

  // step === 'existing'
  return (
    <Modal title="اتصال به حساب باز" onClose={onCancel} width={420}>
      <input
        className="checkout-input opentabs-search"
        placeholder="جستجوی نام یا عنوان…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {filteredTabs.length === 0 && <p className="pos-empty">حساب باز فعالی وجود ندارد</p>}
      <div className="opentabs-list">
        {filteredTabs.map((t) => (
          <button key={t.id} className="opentabs-row" onClick={() => pickExisting(t.id)} disabled={working}>
            <div className="opentabs-row-main">
              <span className="opentabs-row-title">{t.title}</span>
            </div>
            <span className="opentabs-row-amount">{toman(t.grand_total)}</span>
          </button>
        ))}
      </div>
      <div className="checkout-actions">
        <Button variant="ghost" onClick={() => setStep('choose')}>
          بازگشت
        </Button>
      </div>
    </Modal>
  );
}
