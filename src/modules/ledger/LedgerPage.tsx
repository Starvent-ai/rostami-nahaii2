import { useCallback, useState } from 'react';
import { useClubEvent } from '../../lib/useClubEvent';
import { toman, jalaliDateTime } from '../../lib/persian';
import { Card, CardHeader } from '../../components/Card';
import { DataTable } from '../../components/DataTable';
import type { Column } from '../../components/DataTable';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { MoneyInput } from '../../components/MoneyInput';
import '../checkout/CheckoutModal.css';
import './LedgerPage.css';

interface Customer {
  id: number;
  name: string;
  phone: string;
  balance: number;
  last_settled_at: string | null;
}

export function LedgerPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [overdueDays, setOverdueDays] = useState(15);
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [overdueIds, setOverdueIds] = useState<Set<number>>(new Set());
  const [detail, setDetail] = useState<Customer | null>(null);
  const [payTarget, setPayTarget] = useState<Customer | null>(null);
  const [advanceOpen, setAdvanceOpen] = useState(false);

  const load = useCallback(async () => {
    setCustomers(await window.api.customers.list());
    const settings = await window.api.settings.getAll();
    const days = Number(settings.overdue_days_warning ?? 15);
    setOverdueDays(days);
    const overdue = await window.api.customers.overdue(days);
    setOverdueIds(new Set(overdue.map((c: any) => c.id)));
  }, []);
  useClubEvent(['customers', 'settings'], load);

  const rows = (() => {
    // Once a customer's ledger balance is fully settled (0), they drop off
    // this list entirely — the record itself still exists and reappears
    // here automatically if they run up a new debt later.
    const withDebt = customers.filter((c) => c.balance !== 0);
    return onlyOverdue ? withDebt.filter((c) => overdueIds.has(c.id)) : withDebt;
  })();

  function severity(c: Customer): 'none' | 'warn' | 'critical' {
    if (c.balance <= 0) return 'none';
    if (!c.last_settled_at) return overdueIds.has(c.id) ? 'warn' : 'none';
    const days = (Date.now() - new Date(c.last_settled_at).getTime()) / 86400000;
    if (days > overdueDays * 2) return 'critical';
    if (days > overdueDays) return 'warn';
    return 'none';
  }

  const columns: Column<Customer>[] = [
    { key: 'name', label: 'نام مشتری', sortValue: (r) => r.name },
    { key: 'phone', label: 'تلفن' },
    {
      key: 'balance',
      label: 'بدهی فعلی',
      sortValue: (r) => r.balance,
      render: (r) => <span className={`ledger-balance sev-${severity(r)}`}>{toman(r.balance)}</span>,
    },
    {
      key: 'receive',
      label: 'ثبت دریافت',
      render: (r) => (
        <Button
          variant="secondary"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setPayTarget(r);
          }}
        >
          ثبت دریافت
        </Button>
      ),
    },
  ];

  return (
    <div className="ledger-page">
      <Card>
        <CardHeader
          title="حساب دفتری"
          action={
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button variant={onlyOverdue ? 'primary' : 'ghost'} size="sm" onClick={() => setOnlyOverdue((v) => !v)}>
                فقط بدهکاران دیرکرد
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setAdvanceOpen(true)}>
                پرداخت باشگاه
              </Button>
            </div>
          }
        />
        <p className="settings-hint" style={{ marginTop: 0 }}>
          مشتریان جدید و بدهی اولیه از تنظیمات → مشتریان حساب دفتری اضافه می‌شوند.
        </p>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={setDetail} />
      </Card>

      {detail && <CustomerDetailModal customer={detail} onClose={() => setDetail(null)} />}
      {payTarget && <ReceivePaymentModal customer={payTarget} onClose={() => setPayTarget(null)} />}
      {advanceOpen && <ClubAdvanceModal customers={customers} onClose={() => setAdvanceOpen(false)} />}
    </div>
  );
}

function CustomerDetailModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const [history, setHistory] = useState<any[]>([]);
  const load = useCallback(async () => {
    setHistory(await window.api.customers.history(customer.id));
  }, [customer.id]);
  useClubEvent(['customers'], load);

  const KIND_LABEL: Record<string, string> = { charge: 'بدهی', payment: 'دریافتی', advance: 'پرداخت باشگاه' };

  return (
    <Modal title={customer.name} onClose={onClose} width={560}>
      <div className="ledger-detail-head">
        <div>
          <div className="ledger-detail-label">بدهی فعلی</div>
          <div className="ledger-detail-value">{toman(customer.balance)}</div>
        </div>
      </div>

      <h4 className="ledger-history-title">تاریخچه بدهی</h4>
      {history.length === 0 && <p className="pos-empty">تاریخچه‌ای موجود نیست (احتمالاً کاملاً تسویه شده)</p>}
      <div className="ledger-history-list">
        {history.map((h) => (
          <div key={h.id} className={`ledger-history-row ${h.kind === 'payment' ? 'is-payment' : ''}`}>
            <span className="ledger-history-kind">{KIND_LABEL[h.kind] ?? h.kind}</span>
            <span className="ledger-history-note">{h.note}</span>
            <span className="ledger-history-date">{jalaliDateTime(h.created_at)}</span>
            <span className="ledger-history-amount">
              {h.kind === 'payment' ? '−' : '+'}
              {toman(h.amount)}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function ReceivePaymentModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function pay() {
    const amt = Number(amount);
    if (!amt || amt <= 0) return;
    setSubmitting(true);
    try {
      await window.api.ledger.addPayment(customer.id, amt, 'دریافت وجه');
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`ثبت دریافت — ${customer.name}`} onClose={onClose} width={360}>
      <p className="settings-hint" style={{ marginTop: 0 }}>
        بدهی فعلی: {toman(customer.balance)}
      </p>
      <MoneyInput placeholder="مبلغ دریافتی (تومان)" value={amount} onChange={setAmount} autoFocus />
      <div className="checkout-actions">
        <Button variant="primary" disabled={submitting} onClick={pay}>
          ثبت
        </Button>
        <Button variant="ghost" onClick={onClose}>
          انصراف
        </Button>
      </div>
    </Modal>
  );
}

function ClubAdvanceModal({ customers, onClose }: { customers: Customer[]; onClose: () => void }) {
  const [customerId, setCustomerId] = useState<number | ''>('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const amt = Number(amount);
    if (!customerId || !amt || amt <= 0) return;
    setSubmitting(true);
    try {
      await window.api.ledger.addAdvance(customerId, amt, note || 'پرداخت باشگاه');
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="پرداخت باشگاه (علی‌الحساب)" onClose={onClose} width={380}>
      <p className="settings-hint" style={{ marginTop: 0 }}>
        باشگاه مبلغی را به شخص پرداخت می‌کند و این مبلغ به بدهی او اضافه می‌شود.
      </p>
      <select className="checkout-input" value={customerId} onChange={(e) => setCustomerId(Number(e.target.value))}>
        <option value="">انتخاب مشتری…</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <MoneyInput placeholder="مبلغ (تومان)" value={amount} onChange={setAmount} />
      <input className="checkout-input" placeholder="توضیح (اختیاری)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="checkout-actions">
        <Button variant="primary" disabled={submitting || !customerId} onClick={submit}>
          ثبت
        </Button>
        <Button variant="ghost" onClick={onClose}>
          انصراف
        </Button>
      </div>
    </Modal>
  );
}
