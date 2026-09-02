import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { MoneyInput } from '../../components/MoneyInput';
import { toman } from '../../lib/persian';
import { useEnabledPaymentMethods } from '../../lib/usePaymentMethods';
import { PAYMENT_METHOD_ORDER, METHOD_LABEL } from '../checkout/CheckoutModal';
import { SplitBillPanel, type SplitLineItem, type SplitPartResult } from '../checkout/SplitBillPanel';
import '../checkout/CheckoutModal.css';

type PaymentMethod = 'card' | 'cardTransfer' | 'cash' | 'credit';
type Mode = 'single' | 'split';

export function TabCheckoutModal({
  tabId,
  totals,
  items,
  employeeId,
  shiftId,
  onClose,
  onDone,
}: {
  tabId: number;
  totals: { cafeTotal: number; billiardTotal: number; psTotal: number; unitTotal: number; total: number };
  items: any[];
  employeeId: number | null;
  shiftId: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<Mode>('single');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const enabledMethods = useEnabledPaymentMethods();

  const [adjustAdd, setAdjustAdd] = useState('');
  const [adjustDeduct, setAdjustDeduct] = useState('');
  const [adjustNote, setAdjustNote] = useState('');

  useEffect(() => {
    if (!enabledMethods.includes(method)) setMethod(enabledMethods[0] ?? 'cash');
  }, [enabledMethods, method]);

  useEffect(() => {
    (async () => setCustomers(await window.api.customers.list()))();
  }, []);

  const adjustAmount = Number(adjustAdd || 0) - Number(adjustDeduct || 0);
  const finalTotal = totals.total + adjustAmount;
  const totalIsNegative = finalTotal < 0;

  async function confirm() {
    if (method === 'credit' && !customerId) return;
    if (totalIsNegative) return;
    setSubmitting(true);
    try {
      await window.api.openTabs.checkout({
        tabId,
        paymentMethod: method,
        customerId: method === 'credit' && customerId ? customerId : undefined,
        employeeId: employeeId ?? undefined,
        shiftId: shiftId ?? undefined,
        adjustAmount: adjustAmount !== 0 ? adjustAmount : undefined,
        adjustNote: adjustNote.trim() || undefined,
      });
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmSplit(parts: SplitPartResult[]) {
    setSubmitting(true);
    try {
      const result = await window.api.openTabs.checkoutSplit({
        tabId,
        employeeId: employeeId ?? undefined,
        shiftId: shiftId ?? undefined,
        parts: parts.map((p) => ({
          paymentMethod: p.paymentMethod,
          customerId: p.customerId,
          sessionShares: p.shares
            .filter((s) => s.itemKey.startsWith('unit-'))
            .map((s) => ({ sessionId: Number(s.itemKey.slice(5)), amount: s.amount })),
          cafeShares: p.shares
            .filter((s) => s.itemKey.startsWith('cafe-'))
            .map((s) => ({ cafeItemId: Number(s.itemKey.slice(5)), amount: s.amount })),
          adjustAmount: p.shares
            .filter((s) => s.itemKey === 'adjust-add' || s.itemKey === 'adjust-deduct')
            .reduce((sum, s) => sum + s.amount, 0),
          adjustNote: adjustNote.trim() || undefined,
        })),
      });
      if (result.tabClosed) onDone();
      else onClose(); // some items were left unassigned — tab stays open, just close this screen
    } finally {
      setSubmitting(false);
    }
  }

  const splitItems: SplitLineItem[] = [
    ...items.map((it) => ({
      key: `${it.kind}-${it.id}`,
      label: it.kind === 'cafe' ? `${it.description} × ${it.qty}` : it.description,
      amount: it.amount,
    })),
    ...(Number(adjustAdd || 0) > 0 ? [{ key: 'adjust-add', label: `مبلغ دستی${adjustNote ? ` — ${adjustNote}` : ''}`, amount: Number(adjustAdd) }] : []),
    ...(Number(adjustDeduct || 0) > 0
      ? [{ key: 'adjust-deduct', label: `کسر مبلغ${adjustNote ? ` — ${adjustNote}` : ''}`, amount: -Number(adjustDeduct) }]
      : []),
  ];

  return (
    <Modal title="تسویه حساب باز" onClose={onClose} width={480}>
      <div className="checkout-summary">
        <div className="checkout-row">
          <span>جمع کافه</span>
          <span>{toman(totals.cafeTotal)}</span>
        </div>
        <div className="checkout-row">
          <span>جمع بیلیارد</span>
          <span>{toman(totals.billiardTotal)}</span>
        </div>
        <div className="checkout-row">
          <span>جمع PS</span>
          <span>{toman(totals.psTotal)}</span>
        </div>
        {Number(adjustAdd || 0) > 0 && (
          <div className="checkout-row">
            <span>مبلغ دستی</span>
            <span>{toman(Number(adjustAdd))}+</span>
          </div>
        )}
        {Number(adjustDeduct || 0) > 0 && (
          <div className="checkout-row">
            <span>کسر مبلغ</span>
            <span>{toman(Number(adjustDeduct))}-</span>
          </div>
        )}
        <div className="checkout-row total">
          <span>مبلغ نهایی قابل پرداخت</span>
          <span>{toman(finalTotal)}</span>
        </div>
      </div>

      <div className="checkout-adjust-row">
        <MoneyInput className="checkout-input" placeholder="مبلغ دستی (افزودن)" value={adjustAdd} onChange={setAdjustAdd} />
        <MoneyInput className="checkout-input" placeholder="کسر مبلغ" value={adjustDeduct} onChange={setAdjustDeduct} />
      </div>
      {(Number(adjustAdd || 0) > 0 || Number(adjustDeduct || 0) > 0) && (
        <input className="checkout-input" placeholder="توضیح (اختیاری)" value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} />
      )}
      {totalIsNegative && <p className="checkout-error">کسر مبلغ نمی‌تواند مبلغ نهایی را منفی کند</p>}

      <div className="checkout-methods">
        <button className={`checkout-method ${mode === 'single' ? 'active' : ''}`} onClick={() => setMode('single')}>
          یکجا تسویه شود
        </button>
        <button className={`checkout-method ${mode === 'split' ? 'active' : ''}`} onClick={() => setMode('split')}>
          تقسیم حساب
        </button>
      </div>

      {mode === 'single' ? (
        <>
          <div className="checkout-methods">
            {PAYMENT_METHOD_ORDER.filter((m) => enabledMethods.includes(m)).map((m) => (
              <button key={m} className={`checkout-method ${method === m ? 'active' : ''}`} onClick={() => setMethod(m)}>
                {METHOD_LABEL[m]}
              </button>
            ))}
          </div>

          {method === 'credit' && (
            <select className="checkout-input" value={customerId} onChange={(e) => setCustomerId(Number(e.target.value))}>
              <option value="">انتخاب مشتری…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.phone ? `— ${c.phone}` : ''}
                </option>
              ))}
            </select>
          )}

          <div className="checkout-actions">
            <Button variant="primary" disabled={submitting || totalIsNegative || (method === 'credit' && !customerId)} onClick={confirm}>
              ثبت تسویه
            </Button>
            <Button variant="ghost" onClick={onClose}>
              انصراف
            </Button>
          </div>
        </>
      ) : (
        <SplitBillPanel
          items={splitItems}
          customers={customers}
          enabledMethods={enabledMethods}
          submitting={submitting}
          onConfirm={confirmSplit}
          onCancel={onClose}
        />
      )}
    </Modal>
  );
}
