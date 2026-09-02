import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { MoneyInput } from '../../components/MoneyInput';
import { formatDuration } from '../../lib/format';
import { toman } from '../../lib/persian';
import { useEnabledPaymentMethods } from '../../lib/usePaymentMethods';
import { SplitBillPanel, type SplitLineItem, type SplitPartResult } from './SplitBillPanel';
import '../opentabs/opentabs.css';
import './CheckoutModal.css';

interface UnitLite {
  id: number;
  name: string;
  start_time: string | null;
}

type PaymentMethod = 'card' | 'cardTransfer' | 'cash' | 'credit';
type Destination = 'immediate' | 'newTab' | 'existingTab' | 'split';

// Order and naming fixed app-wide: pos، کارت‌به‌کارت، نقدی، حساب دفتری
export const PAYMENT_METHOD_ORDER: PaymentMethod[] = ['card', 'cardTransfer', 'cash', 'credit'];
export const METHOD_LABEL: Record<PaymentMethod, string> = {
  card: 'POS',
  cardTransfer: 'کارت‌به‌کارت',
  cash: 'نقدی',
  credit: 'حساب دفتری',
};

export function CheckoutModal({
  unit,
  employeeId,
  shiftId,
  onClose,
}: {
  unit: UnitLite;
  employeeId: number | null;
  shiftId: number | null;
  onClose: () => void;
}) {
  const [calc, setCalc] = useState<{ exactMinutes: number; exactAmount: number; roundedAmount: number } | null>(null);
  const [cafeTab, setCafeTab] = useState<any[]>([]);
  const [manual, setManual] = useState(false);
  const [manualAmount, setManualAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const enabledMethods = useEnabledPaymentMethods();

  // مبلغ دستی (added to the total) و کسر مبلغ (subtracted) — available
  // regardless of payment mode, and treated like any other line when splitting.
  const [adjustAdd, setAdjustAdd] = useState('');
  const [adjustDeduct, setAdjustDeduct] = useState('');
  const [adjustNote, setAdjustNote] = useState('');

  // Where this game (and any cafe orders already on it) should go: paid right
  // now, or added to a new/existing customer tab (حساب باز) to be paid later —
  // decided here at end-game time, even if the game was started normally.
  const [destination, setDestination] = useState<Destination>('immediate');
  const [openTabs, setOpenTabs] = useState<any[]>([]);
  const [targetTabId, setTargetTabId] = useState<number | ''>('');
  const [newTabCustomer, setNewTabCustomer] = useState('');
  const [newTabNote, setNewTabNote] = useState('');

  useEffect(() => {
    if (!enabledMethods.includes(method)) setMethod(enabledMethods[0] ?? 'cash');
  }, [enabledMethods, method]);

  useEffect(() => {
    (async () => {
      setCafeTab(await window.api.cafeOrder.listForUnit(unit.id));
      setCustomers(await window.api.customers.list());
      setOpenTabs(await window.api.openTabs.list());
    })();
  }, [unit.id]);

  // Snapshot the exact price + duration once, at the moment پایان بازی is
  // opened. Deliberately NOT a live-ticking interval here: unlike the units
  // page tile (which ticks while a game is still in progress), this modal is
  // the checkout itself — once opened, the amount must stay fixed so the
  // operator can split it, pick payment methods, etc. without the target
  // amount changing out from under them mid-task (reproduced live: with a
  // 1s interval, تقسیم حساب's per-share target for the unit-time line kept
  // jumping every time the rounded amount crossed a 5,000-toman boundary,
  // repeatedly re-breaking an already-completed equal split).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await window.api.units.calcAmount(unit.id);
      if (!cancelled) setCalc(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [unit.id]);

  const cafeAmount = cafeTab.reduce((s, i) => s + i.qty * i.unit_price, 0);
  const unitAmount = manual ? Number(manualAmount || 0) : calc?.roundedAmount ?? 0;
  const adjustAmount = Number(adjustAdd || 0) - Number(adjustDeduct || 0);
  const total = unitAmount + cafeAmount + adjustAmount;
  const totalIsNegative = total < 0;

  async function confirm() {
    if (destination !== 'immediate') {
      setSubmitting(true);
      try {
        const tabId =
          destination === 'newTab'
            ? await window.api.openTabs.create({ customerName: newTabCustomer.trim() || undefined, note: newTabNote.trim() || undefined })
            : Number(targetTabId);
        if (!tabId) return;
        if (cafeTab.length > 0) await window.api.openTabCafe.adoptFromUnit(tabId, unit.id);
        await window.api.units.endToTab(unit.id, tabId);
        onClose();
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (method === 'credit' && !customerId) return;
    if (totalIsNegative) return;
    setSubmitting(true);
    try {
      await window.api.checkout.run({
        unitId: unit.id,
        paymentMethod: method,
        customerId: method === 'credit' && customerId ? customerId : undefined,
        employeeId: employeeId ?? undefined,
        shiftId: shiftId ?? undefined,
        manualAmount: manual ? Number(manualAmount || 0) : undefined,
        // Charge exactly what was shown on screen, not a fresh recomputation
        // at confirm time — see the confirmedUnitAmount field comment in
        // electron/core/checkout.ts.
        confirmedUnitAmount: !manual && calc ? calc.roundedAmount : undefined,
        confirmedExactUnitAmount: !manual && calc ? calc.exactAmount : undefined,
        confirmedDurationMinutes: !manual && calc ? Math.round(calc.exactMinutes) : undefined,
        adjustAmount: adjustAmount !== 0 ? adjustAmount : undefined,
        adjustNote: adjustNote.trim() || undefined,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmSplit(parts: SplitPartResult[]) {
    setSubmitting(true);
    try {
      await window.api.checkout.runSplit({
        unitId: unit.id,
        employeeId: employeeId ?? undefined,
        shiftId: shiftId ?? undefined,
        parts: parts.map((p) => ({
          paymentMethod: p.paymentMethod,
          customerId: p.customerId,
          unitAmount: p.shares.find((s) => s.itemKey === 'unit')?.amount ?? 0,
          cafeShares: p.shares
            .filter((s) => s.itemKey.startsWith('cafe-'))
            .map((s) => ({ cafeItemId: Number(s.itemKey.slice(5)), amount: s.amount })),
          adjustAmount: p.shares
            .filter((s) => s.itemKey === 'adjust-add' || s.itemKey === 'adjust-deduct')
            .reduce((sum, s) => sum + s.amount, 0),
          adjustNote: adjustNote.trim() || undefined,
        })),
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  const splitItems: SplitLineItem[] = [
    ...(unitAmount > 0 ? [{ key: 'unit', label: `زمان بازی — ${unit.name}`, amount: unitAmount }] : []),
    ...cafeTab.map((c) => ({ key: `cafe-${c.id}`, label: `${c.name} × ${c.qty}`, amount: c.qty * c.unit_price })),
    ...(Number(adjustAdd || 0) > 0 ? [{ key: 'adjust-add', label: `مبلغ دستی${adjustNote ? ` — ${adjustNote}` : ''}`, amount: Number(adjustAdd) }] : []),
    ...(Number(adjustDeduct || 0) > 0
      ? [{ key: 'adjust-deduct', label: `کسر مبلغ${adjustNote ? ` — ${adjustNote}` : ''}`, amount: -Number(adjustDeduct) }]
      : []),
  ];

  const canSubmit =
    !submitting &&
    !totalIsNegative &&
    ((destination === 'immediate' && !(method === 'credit' && !customerId)) ||
      (destination === 'newTab' && true) ||
      (destination === 'existingTab' && !!targetTabId));

  return (
    <Modal title={`پایان بازی — ${unit.name}`} onClose={onClose} width={480}>
      <div className="checkout-summary">
        <div className="checkout-row">
          <span>مدت دقیق بازی</span>
          <span>{unit.start_time && calc ? formatDuration(calc.exactMinutes * 60000) : '—'}</span>
        </div>
        <div className="checkout-row">
          <span>هزینه دقیق (تا آخرین تومان)</span>
          <span>{toman(calc?.exactAmount ?? 0)}</span>
        </div>
        <div className="checkout-row checkout-row-rounded">
          <span>مبلغ نهایی (گردشده به ۵٬۰۰۰ تومان)</span>
          <span>{toman(unitAmount)}</span>
        </div>
        <div className="checkout-row">
          <span>سفارش کافه</span>
          <span>{toman(cafeAmount)}</span>
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
          <span>{toman(total)}</span>
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
        <button className={`checkout-method ${destination === 'immediate' ? 'active' : ''}`} onClick={() => setDestination('immediate')}>
          پرداخت فوری
        </button>
        <button className={`checkout-method ${destination === 'newTab' ? 'active' : ''}`} onClick={() => setDestination('newTab')}>
          ایجاد حساب جدید
        </button>
        <button className={`checkout-method ${destination === 'existingTab' ? 'active' : ''}`} onClick={() => setDestination('existingTab')}>
          افزودن به حساب باز
        </button>
        <button className={`checkout-method ${destination === 'split' ? 'active' : ''}`} onClick={() => setDestination('split')}>
          تقسیم حساب
        </button>
      </div>

      {destination === 'immediate' && (
        <>
          <label className="checkout-override-toggle">
            <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} />
            ورود دستی مبلغ (به‌دلیل قطعی برق یا تسویه توافقی)
          </label>
          {manual && <MoneyInput placeholder="مبلغ دریافتی (تومان)" value={manualAmount} onChange={setManualAmount} />}

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
        </>
      )}

      {destination === 'newTab' && (
        <>
          <input
            className="checkout-input"
            placeholder="نام مشتری (اختیاری)"
            value={newTabCustomer}
            onChange={(e) => setNewTabCustomer(e.target.value)}
          />
          <textarea
            className="checkout-input"
            placeholder="توضیحات (اختیاری)"
            value={newTabNote}
            onChange={(e) => setNewTabNote(e.target.value)}
            rows={2}
          />
        </>
      )}

      {destination === 'existingTab' && (
        <select className="checkout-input" value={targetTabId} onChange={(e) => setTargetTabId(Number(e.target.value))}>
          <option value="">انتخاب حساب باز…</option>
          {openTabs.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      )}

      {destination === 'split' ? (
        <SplitBillPanel
          items={splitItems}
          customers={customers}
          enabledMethods={enabledMethods}
          submitting={submitting}
          onConfirm={confirmSplit}
          onCancel={onClose}
        />
      ) : (
        <div className="checkout-actions">
          <Button variant="primary" disabled={!canSubmit} onClick={confirm}>
            {destination === 'immediate' ? 'ثبت تسویه' : 'افزودن به حساب'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            انصراف
          </Button>
        </div>
      )}
    </Modal>
  );
}
