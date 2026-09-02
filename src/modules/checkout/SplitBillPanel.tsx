import { useState } from 'react';
import { Button } from '../../components/Button';
import { MoneyInput } from '../../components/MoneyInput';
import { toman } from '../../lib/persian';
import type { PaymentMethodKey } from '../../lib/usePaymentMethods';
import { METHOD_LABEL, PAYMENT_METHOD_ORDER } from './CheckoutModal';
import './SplitBillPanel.css';

export interface SplitLineItem {
  key: string;
  label: string;
  amount: number;
}

export interface SplitPartResult {
  paymentMethod: PaymentMethodKey;
  customerId?: number;
  shares: { itemKey: string; amount: number }[];
}

/** Divides `amount` evenly across `partNumbers`, with any remainder (from
 * amounts that don't divide cleanly, e.g. 100,000 / 3) added to the LAST
 * part — guarantees the shares always sum exactly to `amount`. */
function equalSplit(amount: number, partNumbers: number[]): Record<number, number> {
  const n = partNumbers.length;
  if (n === 0) return {};
  const base = Math.floor(amount / n);
  const remainder = amount - base * n;
  const shares: Record<number, number> = {};
  partNumbers.forEach((p, i) => {
    shares[p] = base + (i === n - 1 ? remainder : 0);
  });
  return shares;
}

/**
 * دنگی / تقسیم حساب: every billable line (table/system time, each cafe
 * item, هر مبلغ دستی یا کسر مبلغ) can go wholly to one numbered "نفر", or be
 * split between several — equal by default, editable per person, with the
 * remainder from an uneven split clearly shown and fixable in one click.
 * Each person then picks their own payment method, so one can pay cash while
 * another puts their share on حساب دفتری. Confirm is disabled until every
 * item's shares add up exactly and every payer-with-a-share has a valid
 * method.
 */
export function SplitBillPanel({
  items,
  customers,
  enabledMethods,
  submitting,
  onConfirm,
  onCancel,
}: {
  items: SplitLineItem[];
  customers: any[];
  enabledMethods: PaymentMethodKey[];
  submitting: boolean;
  onConfirm: (parts: SplitPartResult[]) => void;
  onCancel: () => void;
}) {
  const [partCount, setPartCount] = useState(2);
  // shares[itemKey][partNumber] = amount that part covers of that item.
  const [shares, setShares] = useState<Record<string, Record<number, number>>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [partMethod, setPartMethod] = useState<Record<number, PaymentMethodKey>>({ 1: enabledMethods[0] ?? 'cash', 2: enabledMethods[0] ?? 'cash' });
  const [partCustomer, setPartCustomer] = useState<Record<number, number | ''>>({});

  const parts = Array.from({ length: partCount }, (_, i) => i + 1);

  function addPart() {
    const next = partCount + 1;
    setPartCount(next);
    setPartMethod((m) => ({ ...m, [next]: enabledMethods[0] ?? 'cash' }));
  }

  function assignWhole(itemKey: string, part: number) {
    const item = items.find((i) => i.key === itemKey);
    if (!item) return;
    setShares((s) => ({ ...s, [itemKey]: { [part]: item.amount } }));
    setExpanded((e) => ({ ...e, [itemKey]: false }));
  }

  function splitEqually(itemKey: string) {
    const item = items.find((i) => i.key === itemKey);
    if (!item) return;
    setShares((s) => ({ ...s, [itemKey]: equalSplit(item.amount, parts) }));
    setExpanded((e) => ({ ...e, [itemKey]: true }));
  }

  function editShare(itemKey: string, part: number, value: string) {
    const n = Number(value);
    setShares((s) => ({ ...s, [itemKey]: { ...s[itemKey], [part]: Number.isNaN(n) ? 0 : n } }));
  }

  function fixRemainder(itemKey: string) {
    const item = items.find((i) => i.key === itemKey);
    if (!item) return;
    const current = shares[itemKey] ?? {};
    const assigned = Object.values(current).reduce((s, v) => s + v, 0);
    const remainder = item.amount - assigned;
    const touchedParts = Object.keys(current).map(Number);
    const targetPart = touchedParts[touchedParts.length - 1] ?? 1;
    setShares((s) => ({ ...s, [itemKey]: { ...current, [targetPart]: (current[targetPart] ?? 0) + remainder } }));
  }

  // Per-item validation: every item must have shares assigned that sum exactly to its amount.
  const itemStatus = items.map((it) => {
    const itemShares = shares[it.key] ?? {};
    const assigned = Object.values(itemShares).reduce((s, v) => s + v, 0);
    return { item: it, assigned, remainder: it.amount - assigned, ok: assigned === it.amount && Object.keys(itemShares).length > 0 };
  });
  const allItemsOk = itemStatus.every((s) => s.ok);

  const partTotals = parts.map((p) => ({
    part: p,
    total: items.reduce((sum, it) => sum + (shares[it.key]?.[p] ?? 0), 0),
  }));
  const activeParts = partTotals.filter((p) => p.total > 0);
  const allPartsValid = activeParts.every((p) => partMethod[p.part] !== 'credit' || !!partCustomer[p.part]);
  const canConfirm = !submitting && items.length > 0 && allItemsOk && activeParts.length >= 1 && allPartsValid;

  function confirm() {
    const result: SplitPartResult[] = activeParts.map((p) => ({
      paymentMethod: partMethod[p.part],
      customerId: partMethod[p.part] === 'credit' ? (partCustomer[p.part] as number) : undefined,
      shares: items.filter((it) => (shares[it.key]?.[p.part] ?? 0) > 0).map((it) => ({ itemKey: it.key, amount: shares[it.key][p.part] })),
    }));
    onConfirm(result);
  }

  return (
    <div className="split-bill-panel">
      <p className="settings-hint" style={{ marginTop: 0 }}>
        هر آیتم را به یک نفر بدهید یا بین چند نفر تقسیم کنید، سپس روش پرداخت هر نفر را جدا مشخص کنید.
      </p>

      <div className="split-items">
        {itemStatus.map(({ item, assigned, remainder, ok }) => (
          <div className="split-item-block" key={item.key}>
            <div className="split-item-row">
              <span className="split-item-label">{item.label}</span>
              <span className="split-item-amount">{toman(item.amount)}</span>
              <div className="split-item-parts">
                {parts.map((p) => (
                  <button
                    key={p}
                    className={`split-part-btn ${!expanded[item.key] && shares[item.key]?.[p] === item.amount ? 'active' : ''}`}
                    onClick={() => assignWhole(item.key, p)}
                  >
                    {p.toLocaleString('fa-IR')}
                  </button>
                ))}
                <button className="split-equal-btn" onClick={() => splitEqually(item.key)}>
                  تقسیم مساوی
                </button>
              </div>
            </div>

            {expanded[item.key] && (
              <div className="split-item-breakdown">
                {parts.map((p) => (
                  <div className="split-share-row" key={p}>
                    <span>نفر {p.toLocaleString('fa-IR')}</span>
                    <MoneyInput
                      className="checkout-input split-share-input"
                      allowNegative
                      value={String(shares[item.key]?.[p] ?? 0)}
                      onChange={(v) => editShare(item.key, p, v)}
                    />
                  </div>
                ))}
                {!ok && (
                  <div className="split-remainder-row">
                    <span>
                      {assigned === 0
                        ? 'هنوز سهمی وارد نشده'
                        : remainder > 0
                          ? `باقی‌مانده: ${toman(remainder)}`
                          : `${toman(Math.abs(remainder))} بیش از مبلغ آیتم`}
                    </span>
                    {assigned !== 0 && (
                      <button className="split-fix-btn" onClick={() => fixRemainder(item.key)}>
                        افزودن به آخرین سهم
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <button className="split-add-part" onClick={addPart}>
        + نفر دیگر
      </button>

      <div className="split-parts-config">
        {activeParts.map(({ part, total }) => (
          <div className="split-part-config-row" key={part}>
            <div className="split-part-config-header">
              <span>نفر {part.toLocaleString('fa-IR')}</span>
              <span className="split-part-config-amount">{toman(total)}</span>
            </div>
            <div className="checkout-methods">
              {PAYMENT_METHOD_ORDER.filter((m) => enabledMethods.includes(m)).map((m) => (
                <button
                  key={m}
                  className={`checkout-method ${partMethod[part] === m ? 'active' : ''}`}
                  onClick={() => setPartMethod((s) => ({ ...s, [part]: m }))}
                >
                  {METHOD_LABEL[m]}
                </button>
              ))}
            </div>
            {partMethod[part] === 'credit' && (
              <select
                className="checkout-input"
                value={partCustomer[part] ?? ''}
                onChange={(e) => setPartCustomer((s) => ({ ...s, [part]: Number(e.target.value) }))}
              >
                <option value="">انتخاب مشتری…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.phone ? `— ${c.phone}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>

      {!allItemsOk && items.length > 0 && <p className="checkout-error">همه‌ی آیتم‌ها باید کامل تقسیم شوند (مجموع سهم‌ها با مبلغ آیتم برابر باشد)</p>}

      <div className="checkout-actions">
        <Button variant="primary" disabled={!canConfirm} onClick={confirm}>
          ثبت تسویه تقسیمی
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          انصراف
        </Button>
      </div>
    </div>
  );
}
