import { useCallback, useEffect, useState } from 'react';
import { useClubEvent } from '../../lib/useClubEvent';
import { toman, jalaliDateTime } from '../../lib/persian';
import { Card, CardHeader } from '../../components/Card';
import { Button } from '../../components/Button';
import { DataTable } from '../../components/DataTable';
import type { Column } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { JalaliDatePicker } from '../../components/JalaliDatePicker';
import { MoneyInput } from '../../components/MoneyInput';
import { PinLock } from '../../components/PinLock';
import '../checkout/CheckoutModal.css';
import '../reports/ReportsPage.css';
import './AccountingPage.css';

type Range = 'day' | 'week' | 'month' | 'custom';

const EXPENSE_CATEGORIES = [
  'خرید',
  'تعمیرات دستگاه‌ها',
  'تعمیرات/تغییرات میزها',
  'تعمیرات/تغییرات کلاب',
  'اجاره',
  'آب/برق/گاز',
  'سایر',
];

const METHOD_LABEL: Record<string, string> = { card: 'POS', cardTransfer: 'کارت‌به‌کارت', cash: 'نقدی', credit: 'حساب دفتری' };

// حسابداری shares one PIN with گزارش‌ها (see ReportsPage.tsx) — configured
// once in Settings under "قفل حسابداری و گزارش‌ها", separate from the
// تنظیمات-section PIN. Each page asks independently when visited, same as
// the existing settings lock's per-visit behavior.
export function AccountingPage() {
  return (
    <PinLock pinApi={window.api.reportsPin} title="قفل حسابداری و گزارش‌ها" subtitle="برای ورود، رمز عبور را وارد کنید">
      <AccountingPageInner />
    </PinLock>
  );
}

function AccountingPageInner() {
  const [range, setRange] = useState<Range>('day');
  const [customFrom, setCustomFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<any | null>(null);
  const [txList, setTxList] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [expenseOpen, setExpenseOpen] = useState(false);

  const load = useCallback(async () => {
    const { from, to } = rangeToDates(range, customFrom, customTo);
    const [reportData, tx, exp] = await Promise.all([
      window.api.reports.range(from, to),
      window.api.transactions.list(from, to),
      window.api.expenses.list(from, to),
    ]);
    setData(reportData);
    setTxList(tx);
    setExpenses(exp);
  }, [range, customFrom, customTo]);
  // Live updates (a sale/expense happening elsewhere) still come through this:
  useClubEvent(['transactions', 'cafe_order_items', 'expenses'], load);
  // But switching بازه (day/week/month/custom dates) must also reload right
  // away, not just wait for the next live event — same fix ReportsPage uses.
  useEffect(() => {
    load();
  }, [load]);

  const txColumns: Column<any>[] = [
    { key: 'created_at', label: 'تاریخ و ساعت', render: (r) => jalaliDateTime(r.created_at) },
    { key: 'category', label: 'دسته' },
    { key: 'employee_name', label: 'ثبت‌کننده', render: (r) => r.employee_name ?? '—' },
    { key: 'payment_method', label: 'روش پرداخت', render: (r) => METHOD_LABEL[r.payment_method] ?? r.payment_method },
    { key: 'total_amount', label: 'مبلغ', sortValue: (r) => r.total_amount, render: (r) => toman(r.total_amount) },
    { key: 'note', label: 'توضیح', render: (r) => r.note || '—' },
  ];

  return (
    <div className="accounting-page">
      <Card>
        <CardHeader
          title="گزارش حسابداری"
          action={
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button variant={range === 'day' ? 'primary' : 'ghost'} size="sm" onClick={() => setRange('day')}>
                روزانه
              </Button>
              <Button variant={range === 'week' ? 'primary' : 'ghost'} size="sm" onClick={() => setRange('week')}>
                هفتگی
              </Button>
              <Button variant={range === 'month' ? 'primary' : 'ghost'} size="sm" onClick={() => setRange('month')}>
                ماهانه
              </Button>
              <Button variant={range === 'custom' ? 'primary' : 'ghost'} size="sm" onClick={() => setRange('custom')}>
                بازه دلخواه
              </Button>
            </div>
          }
        />

        {range === 'custom' && (
          <div className="reports-custom-range">
            <JalaliDatePicker value={customFrom} onChange={setCustomFrom} />
            <span>تا</span>
            <JalaliDatePicker value={customTo} onChange={setCustomTo} />
          </div>
        )}

        {data && (
          <div className="acc-summary">
            <div className="acc-cell">
              <span>درآمد بیلیارد</span>
              <strong>{toman(data.totals.billiard_revenue)}</strong>
            </div>
            <div className="acc-cell">
              <span>درآمد PS</span>
              <strong>{toman(data.totals.ps_revenue)}</strong>
            </div>
            <div className="acc-cell">
              <span>درآمد کافه</span>
              <strong>{toman(data.totals.cafe_revenue)}</strong>
            </div>
            <div className="acc-cell">
              <span>POS</span>
              <strong>{toman(data.totals.card)}</strong>
            </div>
            <div className="acc-cell">
              <span>کارت‌به‌کارت</span>
              <strong>{toman(data.totals.cardTransfer)}</strong>
            </div>
            <div className="acc-cell">
              <span>نقدی</span>
              <strong>{toman(data.totals.cash)}</strong>
            </div>
            <div className="acc-cell">
              <span>حساب دفتری (طلب معوق)</span>
              <strong>{toman(data.totals.credit)}</strong>
            </div>
            <div className="acc-cell">
              <span>جمع هزینه‌ها</span>
              <strong className="acc-negative">{toman(data.totals.expense_total)}</strong>
            </div>
            <div className="acc-cell total">
              <span>سود خالص</span>
              <strong>{toman(data.totals.profit)}</strong>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="هزینه‌ها"
          action={
            <Button variant="secondary" size="sm" onClick={() => setExpenseOpen(true)}>
              + ثبت هزینه
            </Button>
          }
        />
        {expenses.length === 0 && <p className="pos-empty">هزینه‌ای در این بازه ثبت نشده</p>}
        <div className="acc-type-list">
          {expenses.map((e) => (
            <div className="acc-type-row" key={e.id}>
              <span>
                {e.category} {e.description && `— ${e.description}`}
              </span>
              <span>{toman(e.amount)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="تراکنش‌ها" />
        <DataTable columns={txColumns} rows={txList} rowKey={(r) => r.id} />
      </Card>

      {expenseOpen && <NewExpenseModal onClose={() => setExpenseOpen(false)} />}
    </div>
  );
}

function NewExpenseModal({ onClose }: { onClose: () => void }) {
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  async function save() {
    if (!amount) return;
    await window.api.expenses.create({ category, amount: Number(amount), description });
    onClose();
  }

  return (
    <Modal title="ثبت هزینه" onClose={onClose} width={360}>
      <select className="checkout-input" value={category} onChange={(e) => setCategory(e.target.value)}>
        {EXPENSE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <MoneyInput placeholder="مبلغ (تومان)" value={amount} onChange={setAmount} />
      <input className="checkout-input" placeholder="توضیح (اختیاری)" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="checkout-actions">
        <Button variant="primary" onClick={save}>
          ثبت
        </Button>
        <Button variant="ghost" onClick={onClose}>
          انصراف
        </Button>
      </div>
    </Modal>
  );
}

function rangeToDates(range: Range, customFrom: string, customTo: string) {
  if (range === 'custom') {
    const to = new Date(customTo);
    to.setHours(23, 59, 59, 999);
    return { from: new Date(customFrom).toISOString(), to: to.toISOString() };
  }
  const to = new Date().toISOString();
  const from = new Date();
  if (range === 'day') from.setHours(0, 0, 0, 0);
  else if (range === 'week') from.setDate(from.getDate() - 7);
  else from.setDate(from.getDate() - 30);
  return { from: from.toISOString(), to };
}
