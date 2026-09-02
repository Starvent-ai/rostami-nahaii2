import { useCallback, useEffect, useState } from 'react';
import { useClubEvent } from '../../lib/useClubEvent';
import { toman, jalaliDateTime, jalaliTime } from '../../lib/persian';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { TabCheckoutModal } from './TabCheckoutModal';
import { MoneyInput } from '../../components/MoneyInput';
import '../checkout/CheckoutModal.css';
import '../cafe/CafeBuffetPage.css';
import './opentabs.css';

export function TabDetailModal({
  tabId,
  employeeId,
  shiftId,
  allTabs,
  onClose,
  onClosedTab,
}: {
  tabId: number;
  employeeId: number | null;
  shiftId: number | null;
  allTabs: any[];
  onClose: () => void;
  onClosedTab: () => void;
}) {
  const [detail, setDetail] = useState<{ tab: any; items: any[]; totals: any } | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [transferItem, setTransferItem] = useState<{ id: number; kind: string } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Inline کافه و بوفه picker — toggled next to "جمع کافه" so staff can add
  // (or, via the existing +/- on each line, remove) cafe items without
  // leaving this tab's detail view.
  const [cafePickerOpen, setCafePickerOpen] = useState(false);
  const [cafeItems, setCafeItems] = useState<any[]>([]);
  const [cafeSearch, setCafeSearch] = useState('');

  const load = useCallback(async () => {
    setDetail(await window.api.openTabs.get(tabId));
  }, [tabId]);
  useClubEvent(['open_tabs', 'cafe_items'], load);

  useEffect(() => {
    if (cafePickerOpen) (async () => setCafeItems(await window.api.cafeItems.list()))();
  }, [cafePickerOpen]);

  if (!detail) return null;
  const { tab, items, totals } = detail;

  async function saveField(field: string, value: string | number | null) {
    await window.api.openTabs.update(tabId, { [field]: value } as any);
  }

  async function doDelete() {
    setDeleteError('');
    try {
      await window.api.openTabs.delete(tabId);
      onClosedTab();
    } catch (err: any) {
      setDeleteError(err?.message || 'حذف حساب ممکن نشد');
      setConfirmingDelete(false);
    }
  }

  async function changeCafeQty(id: number, delta: number) {
    await window.api.openTabCafe.changeQty(id, delta);
  }
  async function removeCafe(id: number) {
    await window.api.openTabCafe.remove(id);
  }
  async function addCafeItem(cafeItemId: number) {
    await window.api.openTabCafe.add(tabId, cafeItemId, 1);
  }
  async function removeSession(id: number) {
    await window.api.openTabSessions.remove(id);
  }
  async function saveAmount(kind: string, id: number, amount: number) {
    if (kind === 'cafe') await window.api.openTabCafe.updatePrice(id, amount);
    else await window.api.openTabSessions.updateAmount(id, amount);
  }
  async function doTransfer(toTabId: number) {
    if (!transferItem) return;
    if (transferItem.kind === 'cafe') await window.api.openTabCafe.transfer(transferItem.id, toTabId);
    else await window.api.openTabSessions.transfer(transferItem.id, toTabId);
    setTransferItem(null);
  }

  const otherTabs = allTabs.filter((t) => t.id !== tabId);

  return (
    <>
      <Modal title={`حساب — ${tab.title}`} onClose={onClose} width={640}>
        <div className="opentabs-detail-header">
          <div className="settings-form-row">
            <label>نام</label>
            <input className="checkout-input" style={{ margin: 0 }} defaultValue={tab.title} onBlur={(e) => saveField('title', e.target.value)} />
          </div>
          <div className="settings-form-row">
            <label>توضیحات</label>
            <input
              className="checkout-input"
              style={{ margin: 0 }}
              defaultValue={tab.note ?? ''}
              onBlur={(e) => saveField('note', e.target.value)}
            />
          </div>
          <p className="settings-hint-inline">باز شده از {jalaliDateTime(tab.created_at)}</p>
        </div>

        <div className="opentabs-timeline">
          {items.length === 0 && <p className="pos-empty">هنوز آیتمی ثبت نشده</p>}
          {items.map((it: any) => {
            const icon = it.kind === 'cafe' ? '☕' : it.unit_kind === 'billiard' ? '🎱' : '🎮';
            return (
              <div className="opentabs-timeline-row" key={`${it.kind}-${it.id}`}>
                <span className="opentabs-timeline-time">{jalaliTime(it.created_at)}</span>
                <span className="opentabs-timeline-icon">{icon}</span>
                <span className="opentabs-timeline-desc">
                  {it.description}
                  {it.kind === 'cafe' && it.qty > 1 ? ` × ${it.qty}` : ''}
                </span>
                {it.kind === 'cafe' && (
                  <div className="cafe-cart-qty">
                    <button onClick={() => changeCafeQty(it.id, -1)}>−</button>
                    <span>{it.qty}</span>
                    <button onClick={() => changeCafeQty(it.id, 1)}>+</button>
                  </div>
                )}
                <EditableAmount value={it.amount} onSave={(n) => saveAmount(it.kind, it.id, n)} />
                <button className="pos-tab-remove" onClick={() => setTransferItem({ id: it.id, kind: it.kind })}>
                  انتقال
                </button>
                <button className="pos-tab-remove" onClick={() => (it.kind === 'cafe' ? removeCafe(it.id) : removeSession(it.id))}>
                  حذف
                </button>
              </div>
            );
          })}
        </div>

        <div className="opentabs-totals">
          <div className="reports-list-row">
            <span>
              جمع کافه
              <button className="opentabs-cafe-toggle" onClick={() => setCafePickerOpen((v) => !v)}>
                {cafePickerOpen ? 'بستن' : '+ افزودن'}
              </button>
            </span>
            <span>{toman(totals.cafeTotal)}</span>
          </div>

          {cafePickerOpen && (
            <div className="opentabs-cafe-picker">
              <input
                className="checkout-input cafe-search"
                placeholder="جستجوی محصول…"
                value={cafeSearch}
                onChange={(e) => setCafeSearch(e.target.value)}
              />
              <div className="cafe-categories-row">
                {Object.entries(
                  cafeItems
                    .filter((it) => it.name.toLowerCase().includes(cafeSearch.trim().toLowerCase()))
                    .reduce<Record<string, any[]>>((acc, it) => {
                      (acc[it.category] ??= []).push(it);
                      return acc;
                    }, {})
                ).map(([cat, list]) => (
                  <div key={cat} className="cafe-category-column">
                    <div className="cafe-category-title">{cat}</div>
                    <div className="cafe-grid">
                      {list.map((it) => (
                        <button key={it.id} className="cafe-item" onClick={() => addCafeItem(it.id)} disabled={it.stock <= 0}>
                          <span>{it.name}</span>
                          <span className="cafe-item-price">{toman(it.price)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="reports-list-row">
            <span>جمع بیلیارد</span>
            <span>{toman(totals.billiardTotal)}</span>
          </div>
          <div className="reports-list-row">
            <span>جمع PS</span>
            <span>{toman(totals.psTotal)}</span>
          </div>
          <div className="checkout-row total">
            <span>جمع کل</span>
            <span>{toman(totals.total)}</span>
          </div>
        </div>

        <div className="checkout-actions">
          <Button variant="primary" onClick={() => setCheckoutOpen(true)} disabled={items.length === 0}>
            تسویه حساب
          </Button>
          <Button variant="ghost" onClick={onClose}>
            بستن
          </Button>
          <Button variant="ghost" onClick={() => setConfirmingDelete(true)}>
            حذف حساب
          </Button>
        </div>
        {deleteError && <p className="checkout-error">{deleteError}</p>}
      </Modal>

      {confirmingDelete && (
        <Modal title="حذف حساب باز" onClose={() => setConfirmingDelete(false)} width={360}>
          <p className="settings-hint" style={{ marginTop: 0 }}>
            حساب «{tab.title}» و هر آیتم تسویه‌نشده‌ی روی آن برای همیشه حذف می‌شود. این کار قابل بازگشت نیست.
          </p>
          <div className="checkout-actions">
            <Button variant="primary" onClick={doDelete}>
              بله، حذف شود
            </Button>
            <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
              انصراف
            </Button>
          </div>
        </Modal>
      )}

      {transferItem && (
        <Modal title="انتقال آیتم به حساب دیگر" onClose={() => setTransferItem(null)} width={360}>
          <div className="opentabs-list">
            {otherTabs.map((t) => (
              <button key={t.id} className="opentabs-row" onClick={() => doTransfer(t.id)}>
                <div className="opentabs-row-main">
                  <span className="opentabs-row-title">{t.title}</span>
                </div>
              </button>
            ))}
            {otherTabs.length === 0 && <p className="pos-empty">حساب باز دیگری وجود ندارد</p>}
          </div>
        </Modal>
      )}

      {checkoutOpen && (
        <TabCheckoutModal
          tabId={tabId}
          totals={totals}
          items={items}
          employeeId={employeeId}
          shiftId={shiftId}
          onClose={() => setCheckoutOpen(false)}
          onDone={() => {
            setCheckoutOpen(false);
            onClosedTab();
          }}
        />
      )}
    </>
  );
}

/** Click the amount to edit it inline — matches the onBlur-to-save pattern used across Settings. */
function EditableAmount({ value, onSave }: { value: number; onSave: (n: number) => void }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button className="opentabs-timeline-amount" onClick={() => setEditing(true)} title="ویرایش مبلغ">
        {toman(value)}
      </button>
    );
  }
  return (
    <MoneyInput
      className="checkout-input opentabs-amount-input"
      value={String(value)}
      onChange={() => {}}
      autoFocus
      onBlur={(digits) => {
        const n = Number(digits || 0);
        setEditing(false);
        if (!Number.isNaN(n) && n >= 0 && n !== value) onSave(n);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
