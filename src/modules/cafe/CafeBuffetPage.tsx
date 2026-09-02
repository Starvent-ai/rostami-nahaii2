import { useCallback, useEffect, useState } from 'react';
import { useClubEvent } from '../../lib/useClubEvent';
import { toman } from '../../lib/persian';
import { useEnabledPaymentMethods } from '../../lib/usePaymentMethods';
import { PAYMENT_METHOD_ORDER, METHOD_LABEL } from '../checkout/CheckoutModal';
import { SplitBillPanel, type SplitLineItem, type SplitPartResult } from '../checkout/SplitBillPanel';
import { Card, CardHeader } from '../../components/Card';
import { Button } from '../../components/Button';
import '../checkout/CheckoutModal.css';
import '../opentabs/opentabs.css';
import './CafeBuffetPage.css';

type PaymentMethod = 'card' | 'cardTransfer' | 'cash' | 'credit';
type Destination = 'immediate' | 'newTab' | 'existingTab' | 'split';

interface CartLine {
  cafeItemId: number;
  name: string;
  price: number;
  qty: number;
}

export function CafeBuffetPage({ employeeId, shiftId }: { employeeId: number | null; shiftId: number | null }) {
  const [items, setItems] = useState<any[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const enabledMethods = useEnabledPaymentMethods();

  // Where this cart's total should go: paid immediately, or accumulated on a
  // customer's open tab (حساب باز) — new or existing — to be paid later.
  const [destination, setDestination] = useState<Destination>('immediate');
  const [openTabs, setOpenTabs] = useState<any[]>([]);
  const [targetTabId, setTargetTabId] = useState<number | ''>('');
  const [newTabCustomer, setNewTabCustomer] = useState('');
  const [newTabNote, setNewTabNote] = useState('');

  useEffect(() => {
    if (!enabledMethods.includes(method)) setMethod(enabledMethods[0] ?? 'cash');
  }, [enabledMethods, method]);

  const load = useCallback(async () => {
    setItems(await window.api.cafeItems.list());
    setCustomers(await window.api.customers.list());
    setOpenTabs(await window.api.openTabs.list());
  }, []);
  useClubEvent(['cafe_items', 'customers', 'open_tabs'], load);

  function add(item: any) {
    setCart((prev) => {
      const existing = prev.find((l) => l.cafeItemId === item.id);
      if (existing) {
        return prev.map((l) => (l.cafeItemId === item.id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, { cafeItemId: item.id, name: item.name, price: item.price, qty: 1 }];
    });
  }

  function changeQty(cafeItemId: number, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.cafeItemId === cafeItemId ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0)
    );
  }

  const total = cart.reduce((s, l) => s + l.qty * l.price, 0);

  async function submit() {
    if (cart.length === 0) return;

    if (destination !== 'immediate') {
      setSubmitting(true);
      try {
        const tabId = destination === 'newTab' ? await window.api.openTabs.create({ customerName: newTabCustomer.trim() || undefined, note: newTabNote.trim() || undefined }) : Number(targetTabId);
        if (!tabId) return;
        for (const l of cart) {
          await window.api.openTabCafe.add(tabId, l.cafeItemId, l.qty);
        }
        setCart([]);
        setNewTabCustomer('');
        setNewTabNote('');
        setTargetTabId('');
        setDestination('immediate');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (method === 'credit' && !customerId) return;
    setSubmitting(true);
    try {
      await window.api.checkout.run({
        standaloneCafe: cart.map((l) => ({ cafeItemId: l.cafeItemId, qty: l.qty })),
        paymentMethod: method,
        customerId: method === 'credit' && customerId ? customerId : undefined,
        employeeId: employeeId ?? undefined,
        shiftId: shiftId ?? undefined,
      });
      setCart([]);
      setCustomerId('');
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    !submitting &&
    ((destination === 'immediate' && !(method === 'credit' && !customerId)) ||
      (destination === 'newTab' && true) ||
      (destination === 'existingTab' && !!targetTabId));

  async function confirmSplit(parts: SplitPartResult[]) {
    setSubmitting(true);
    try {
      // Each cart line's actual product/stock decrement is billed under
      // whichever part claims the LARGEST share of it (so inventory and
      // per-product reports stay correctly attributed); any other, smaller
      // claim on that same line is still charged in full to its own payer —
      // just as a plain amount adjustment rather than a separate stock line.
      const primaryPartForLine = new Map<number, number>();
      cart.forEach((l) => {
        let bestPart = -1;
        let bestAmount = -1;
        parts.forEach((p, i) => {
          const amount = p.shares.find((s) => s.itemKey === String(l.cafeItemId))?.amount ?? 0;
          if (amount > bestAmount) {
            bestAmount = amount;
            bestPart = i;
          }
        });
        if (bestPart >= 0) primaryPartForLine.set(l.cafeItemId, bestPart);
      });

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const primaryLines = cart.filter((l) => primaryPartForLine.get(l.cafeItemId) === i);
        let adjust = 0;
        for (const s of part.shares) {
          const cafeItemId = Number(s.itemKey);
          if (primaryPartForLine.get(cafeItemId) === i) {
            const line = cart.find((l) => l.cafeItemId === cafeItemId)!;
            adjust += s.amount - line.qty * line.price; // this part's own claim vs. the full line it's billing
          } else {
            adjust += s.amount; // a smaller claim on a line primarily billed to a different part
          }
        }
        if (primaryLines.length === 0 && adjust === 0) continue;

        await window.api.checkout.run({
          standaloneCafe: primaryLines.map((l) => ({ cafeItemId: l.cafeItemId, qty: l.qty })),
          paymentMethod: part.paymentMethod,
          customerId: part.customerId,
          employeeId: employeeId ?? undefined,
          shiftId: shiftId ?? undefined,
          adjustAmount: adjust !== 0 ? adjust : undefined,
        });
      }
      setCart([]);
      setDestination('immediate');
    } finally {
      setSubmitting(false);
    }
  }

  const splitItems: SplitLineItem[] = cart.map((l) => ({
    key: String(l.cafeItemId),
    label: `${l.name} × ${l.qty}`,
    amount: l.qty * l.price,
  }));

  const query = search.trim().toLowerCase();
  const filteredItems = query ? items.filter((it) => it.name.toLowerCase().includes(query)) : items;
  const byCategory = filteredItems.reduce<Record<string, any[]>>((acc, it) => {
    (acc[it.category] ??= []).push(it);
    return acc;
  }, {});

  return (
    <div className="cafe-page">
      <Card className="cafe-catalog">
        <CardHeader title="کافه و بوفه — فروش مستقل" />
        <input
          className="checkout-input cafe-search"
          placeholder="جستجوی محصول…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="cafe-categories-row">
          {Object.entries(byCategory).map(([cat, list]) => (
            <div key={cat} className="cafe-category-column">
              <div className="cafe-category-title">{cat}</div>
              <div className="cafe-grid">
                {list.map((it) => (
                  <button key={it.id} className="cafe-item" onClick={() => add(it)} disabled={it.stock <= 0}>
                    <span>{it.name}</span>
                    <span className="cafe-item-price">{toman(it.price)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {items.length === 0 && <p className="pos-empty">هنوز محصولی در تنظیمات تعریف نشده</p>}
        {items.length > 0 && Object.keys(byCategory).length === 0 && <p className="pos-empty">موردی یافت نشد</p>}
      </Card>

      <Card className="cafe-cart">
        <CardHeader title="سبد فروش" />
        {cart.length === 0 && <p className="pos-empty">سبد خالی است</p>}
        {cart.map((l) => (
          <div key={l.cafeItemId} className="cafe-cart-row">
            <span className="cafe-cart-name">{l.name}</span>
            <div className="cafe-cart-qty">
              <button onClick={() => changeQty(l.cafeItemId, -1)}>−</button>
              <span>{l.qty}</span>
              <button onClick={() => changeQty(l.cafeItemId, 1)}>+</button>
            </div>
            <span className="cafe-cart-amount">{toman(l.qty * l.price)}</span>
          </div>
        ))}

        {cart.length > 0 && (
          <>
            <div className="cafe-cart-total">
              <span>جمع کل</span>
              <span>{toman(total)}</span>
            </div>

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
                        {c.name}
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
                onCancel={() => setDestination('immediate')}
              />
            ) : (
              <Button variant="primary" disabled={!canSubmit} onClick={submit}>
                {destination === 'immediate' ? 'ثبت فروش' : 'افزودن به حساب'}
              </Button>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
