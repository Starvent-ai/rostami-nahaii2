import { useCallback, useEffect, useState } from 'react';
import { useClubEvent } from '../../lib/useClubEvent';
import { formatDuration, calcUnitAmount } from '../../lib/format';
import { toman } from '../../lib/persian';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { CheckoutModal } from '../checkout/CheckoutModal';
import { StartGameWithTabModal } from '../opentabs/StartGameWithTabModal';
import { EndToTabModal } from '../opentabs/EndToTabModal';
import { LinkToTabModal } from '../opentabs/LinkToTabModal';
import '../checkout/CheckoutModal.css';
import '../cafe/CafeBuffetPage.css';
import '../opentabs/opentabs.css';
import './UnitsPage.css';

interface Unit {
  id: number;
  name: string;
  unit_type_id: number;
  unit_type_name: string;
  unit_type_kind: 'billiard' | 'ps';
  unit_number: number | null;
  is_pro: number;
  hourly_rate: number;
  ps_tier1_price: number;
  ps_tier2_price: number;
  ps_tier3_price: number;
  ps_tier4_price: number;
  round_minutes: number;
  image: string;
  image_playing: string | null;
  status: 'free' | 'playing' | 'reserved';
  start_time: string | null;
  active_tiers: number | null;
  linked_tab_id: number | null;
  linked_tab_title: string | null;
}

const STATUS_LABEL: Record<Unit['status'], string> = {
  free: 'آزاد',
  playing: 'در حال بازی',
  reserved: 'رزرو شده',
};

export function UnitsPage({ activeShiftId, activeEmployeeId }: { activeShiftId: number | null; activeEmployeeId: number | null }) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [now, setNow] = useState(Date.now());
  const [posUnit, setPosUnit] = useState<Unit | null>(null);
  const [checkoutUnit, setCheckoutUnit] = useState<Unit | null>(null);
  const [tierPickerUnit, setTierPickerUnit] = useState<Unit | null>(null);
  const [tabStartUnit, setTabStartUnit] = useState<Unit | null>(null);
  const [endToTabUnit, setEndToTabUnit] = useState<Unit | null>(null);
  const [linkTabUnit, setLinkTabUnit] = useState<Unit | null>(null);

  const load = useCallback(async () => {
    setUnits(await window.api.units.list());
  }, []);
  useClubEvent(['units'], load);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function startGame(u: Unit) {
    if (u.unit_type_kind === 'ps') {
      setTierPickerUnit(u);
      return;
    }
    await window.api.units.start(u.id);
  }
  async function reserve(u: Unit) {
    await window.api.units.reserve(u.id);
  }
  async function cancelReserve(u: Unit) {
    await window.api.units.cancelReserve(u.id);
  }
  // A unit linked to an open tab (حساب باز) ends onto that tab instead of an
  // immediate checkout — payment happens later when the whole tab is closed.
  function handleCheckout(u: Unit) {
    if (u.linked_tab_id) setEndToTabUnit(u);
    else setCheckoutUnit(u);
  }

  const billiardUnits = units.filter((u) => u.unit_type_kind === 'billiard');
  const ps4Units = units.filter((u) => u.unit_type_kind === 'ps' && u.unit_type_name === 'PS4');
  const ps5Units = units.filter((u) => u.unit_type_kind === 'ps' && u.unit_type_name === 'PS5');

  return (
    <div className="units-page">
      {billiardUnits.length > 0 && (
        <section>
          <h3 className="units-section-title">میزهای بیلیارد</h3>
          <div className="units-grid">
            {billiardUnits.map((u) => (
              <UnitCard
                key={u.id}
                unit={u}
                now={now}
                onStart={() => startGame(u)}
                onReserve={() => reserve(u)}
                onCancelReserve={() => cancelReserve(u)}
                onAddCafe={() => setPosUnit(u)}
                onCheckout={() => handleCheckout(u)}
                onStartWithTab={() => setTabStartUnit(u)}
                onLinkToTab={() => setLinkTabUnit(u)}
              />
            ))}
          </div>
        </section>
      )}

      {ps4Units.length > 0 && (
        <section>
          <h3 className="units-section-title">سیستم‌های PS4</h3>
          <div className="units-grid">
            {ps4Units.map((u) => (
              <UnitCard
                key={u.id}
                unit={u}
                now={now}
                onStart={() => startGame(u)}
                onReserve={() => reserve(u)}
                onCancelReserve={() => cancelReserve(u)}
                onAddCafe={() => setPosUnit(u)}
                onCheckout={() => handleCheckout(u)}
                onStartWithTab={() => setTabStartUnit(u)}
                onLinkToTab={() => setLinkTabUnit(u)}
              />
            ))}
          </div>
        </section>
      )}

      {ps5Units.length > 0 && (
        <section>
          <h3 className="units-section-title">سیستم‌های PS5</h3>
          <div className="units-grid">
            {ps5Units.map((u) => (
              <UnitCard
                key={u.id}
                unit={u}
                now={now}
                onStart={() => startGame(u)}
                onReserve={() => reserve(u)}
                onCancelReserve={() => cancelReserve(u)}
                onAddCafe={() => setPosUnit(u)}
                onCheckout={() => handleCheckout(u)}
                onStartWithTab={() => setTabStartUnit(u)}
                onLinkToTab={() => setLinkTabUnit(u)}
              />
            ))}
          </div>
        </section>
      )}

      {units.length === 0 && (
        <Card>
          <p style={{ color: 'var(--text-400)' }}>هنوز میز/سیستمی تعریف نشده — از تنظیمات اضافه کنید.</p>
        </Card>
      )}

      {posUnit && <UnitCafeModal unit={posUnit} onClose={() => setPosUnit(null)} />}
      {checkoutUnit && (
        <CheckoutModal
          unit={checkoutUnit}
          employeeId={activeEmployeeId}
          shiftId={activeShiftId}
          onClose={() => setCheckoutUnit(null)}
        />
      )}
      {tierPickerUnit && (
        <TierPickerModal
          unit={tierPickerUnit}
          onClose={() => setTierPickerUnit(null)}
          onConfirm={async (tiers) => {
            await window.api.units.start(tierPickerUnit.id, undefined, tiers);
            setTierPickerUnit(null);
          }}
        />
      )}
      {tabStartUnit && <StartGameWithTabModal unit={tabStartUnit} onClose={() => setTabStartUnit(null)} />}
      {linkTabUnit && <LinkToTabModal unit={linkTabUnit} onClose={() => setLinkTabUnit(null)} />}
      {endToTabUnit && <EndToTabModal unit={endToTabUnit} onClose={() => setEndToTabUnit(null)} />}
    </div>
  );
}

function TierPickerModal({ unit, onClose, onConfirm }: { unit: Unit; onClose: () => void; onConfirm: (tiers: number) => void }) {
  const [tiers, setTiers] = useState(1);
  const tierPrices = [unit.ps_tier1_price, unit.ps_tier2_price, unit.ps_tier3_price, unit.ps_tier4_price];
  const total = tierPrices.slice(0, tiers).reduce((s, p) => s + p, 0);

  return (
    <Modal title={`شروع بازی — ${unit.name}`} onClose={onClose} width={360}>
      <p className="settings-hint" style={{ marginTop: 0 }}>
        تعداد دسته‌های فعال برای این بازی را انتخاب کنید
      </p>
      <div className="tier-picker-grid">
        {[1, 2, 3, 4].map((n) => (
          <button key={n} className={`tier-picker-choice ${tiers === n ? 'active' : ''}`} onClick={() => setTiers(n)}>
            {n} دسته
          </button>
        ))}
      </div>
      <div className="tier-picker-total">{toman(total)} / ساعت</div>
      <div className="checkout-actions">
        <Button variant="primary" onClick={() => onConfirm(tiers)}>
          شروع بازی
        </Button>
        <Button variant="ghost" onClick={onClose}>
          انصراف
        </Button>
      </div>
    </Modal>
  );
}

function UnitCard({
  unit,
  now,
  onStart,
  onReserve,
  onCancelReserve,
  onAddCafe,
  onCheckout,
  onStartWithTab,
  onLinkToTab,
}: {
  unit: Unit;
  now: number;
  onStart: () => void;
  onReserve: () => void;
  onCancelReserve: () => void;
  onAddCafe: () => void;
  onCheckout: () => void;
  onStartWithTab: () => void;
  onLinkToTab: () => void;
}) {
  const elapsed = unit.start_time ? now - new Date(unit.start_time).getTime() : 0;
  return (
    <div className={`unit-card status-${unit.status}`}>
      <div className="unit-card-media">
        <UnitIllustration kind={unit.unit_type_kind} status={unit.status} image={unit.image} imagePlaying={unit.image_playing} />
        <span className={`unit-status-badge status-${unit.status}`}>{STATUS_LABEL[unit.status]}</span>
      </div>
      <div className="unit-card-body">
        <div className="unit-card-title-row">
          <h4>{unit.unit_type_name}</h4>
          {unit.unit_number != null && <span className="unit-number-badge">شماره {unit.unit_number.toLocaleString('fa-IR')}</span>}
        </div>
        <div className="unit-rate">
          {unit.unit_type_kind === 'ps' && unit.status === 'playing' && unit.active_tiers
            ? `${unit.active_tiers} دسته فعال — `
            : ''}
          {toman(unit.hourly_rate)} / ساعت
        </div>
        {unit.status === 'playing' && (
          <div className="unit-timer-row">
            <div className="unit-timer">{formatDuration(elapsed)}</div>
            <div className="unit-live-cost">{toman(calcUnitAmount(elapsed, unit.hourly_rate).exactAmount)}</div>
          </div>
        )}
        {unit.status === 'playing' && unit.linked_tab_title && (
          <div className="opentabs-linked-badge">🔗 حساب: {unit.linked_tab_title}</div>
        )}

        <div className="unit-actions">
          {unit.status === 'free' && (
            <>
              <Button variant="primary" size="sm" onClick={onStart}>
                شروع بازی
              </Button>
              <Button variant="ghost" size="sm" onClick={onStartWithTab}>
                + به حساب باز
              </Button>
              <Button variant="ghost" size="sm" onClick={onReserve}>
                رزرو
              </Button>
            </>
          )}
          {unit.status === 'playing' && (
            <>
              <Button variant="secondary" size="sm" onClick={onAddCafe}>
                + سفارش کافه
              </Button>
              {!unit.linked_tab_id && (
                <Button variant="ghost" size="sm" onClick={onLinkToTab}>
                  + به حساب باز
                </Button>
              )}
              <Button variant="primary" size="sm" onClick={onCheckout}>
                پایان بازی
              </Button>
            </>
          )}
          {unit.status === 'reserved' && (
            <>
              <Button variant="primary" size="sm" onClick={onStart}>
                شروع بازی
              </Button>
              <Button variant="ghost" size="sm" onClick={onStartWithTab}>
                + به حساب باز
              </Button>
              <Button variant="ghost" size="sm" onClick={onCancelReserve}>
                لغو رزرو
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Per-type professional photo/illustration when the club has uploaded one
 * (Settings → انواع میز و سیستم), falling back to the built-in stylized SVG
 * otherwise. While a unit is "در حال بازی", shows `imagePlaying` if the club
 * uploaded a distinct "occupied" photo for that type; otherwise reuses the
 * same free-state photo (the status badge + colored border still make the
 * occupied state clear).
 */
function UnitIllustration({
  kind,
  status,
  image,
  imagePlaying,
}: {
  kind: 'billiard' | 'ps';
  status: Unit['status'];
  image?: string | null;
  imagePlaying?: string | null;
}) {
  const customSrc = status === 'playing' && imagePlaying ? imagePlaying : image;
  if (customSrc) {
    return <img src={customSrc} alt="" className={`unit-illustration unit-illustration-photo status-${status}`} />;
  }
  const glow = status === 'playing' ? 'var(--status-playing)' : status === 'reserved' ? 'var(--status-reserved)' : 'var(--status-free)';
  if (kind === 'billiard') {
    return (
      <svg viewBox="0 0 200 120" className="unit-illustration">
        <defs>
          <linearGradient id={`felt-${status}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={glow} stopOpacity="0.55" />
            <stop offset="100%" stopColor={glow} stopOpacity="0.15" />
          </linearGradient>
        </defs>
        <rect x="14" y="70" width="172" height="14" rx="4" fill="#3a2a15" />
        <rect x="24" y="20" width="152" height="56" rx="6" fill="#1c140a" />
        <rect x="30" y="26" width="140" height="44" rx="3" fill={`url(#felt-${status})`} stroke={glow} strokeWidth="1.5" />
        <circle cx="34" cy="30" r="3.5" fill="#111" />
        <circle cx="166" cy="30" r="3.5" fill="#111" />
        <circle cx="34" cy="66" r="3.5" fill="#111" />
        <circle cx="166" cy="66" r="3.5" fill="#111" />
        <circle cx="100" cy="30" r="3.5" fill="#111" />
        <circle cx="100" cy="66" r="3.5" fill="#111" />
        <circle cx="80" cy="48" r="4" fill="#f6e7b4" />
        <circle cx="120" cy="42" r="4" fill="#e5484d" />
        <circle cx="105" cy="55" r="4" fill="#e4e7eb" />
        {[12, 30, 48, 66, 84].map((x) => (
          <rect key={x} x={x} y="86" width="4" height="20" fill="#2a2a33" />
        ))}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 200 120" className="unit-illustration">
      <defs>
        <linearGradient id={`console-${status}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={glow} stopOpacity="0.5" />
          <stop offset="100%" stopColor={glow} stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <rect x="55" y="24" width="90" height="20" rx="6" fill="#16161c" stroke={glow} strokeWidth="1.2" />
      <rect x="58" y="27" width="84" height="14" rx="3" fill={`url(#console-${status})`} />
      <circle cx="66" cy="34" r="2" fill={glow} />
      <ellipse cx="70" cy="80" rx="34" ry="20" fill="#16161c" stroke={glow} strokeWidth="1.2" />
      <circle cx="58" cy="80" r="6" fill="#0e0e12" />
      <circle cx="82" cy="80" r="4" fill="#e5484d" />
      <circle cx="90" cy="72" r="4" fill="#34c77b" />
      <ellipse cx="130" cy="80" rx="34" ry="20" fill="#16161c" stroke={glow} strokeWidth="1.2" />
      <circle cx="142" cy="80" r="6" fill="#0e0e12" />
      <circle cx="118" cy="80" r="4" fill="#4c8fe3" />
      <circle cx="110" cy="72" r="4" fill="#e3a53c" />
    </svg>
  );
}

function UnitCafeModal({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  // A unit linked to an open tab (حساب باز) routes its cafe orders onto that
  // tab instead of the unit's own tab — so they end up on the tab's combined
  // invoice rather than being paid separately at this unit's own checkout.
  const linkedTabId = unit.linked_tab_id;
  const [items, setItems] = useState<any[]>([]);
  const [tab, setTab] = useState<any[]>([]);

  const load = useCallback(async () => {
    setItems(await window.api.cafeItems.list());
    setTab(linkedTabId ? await window.api.openTabCafe.listForTab(linkedTabId) : await window.api.cafeOrder.listForUnit(unit.id));
  }, [unit.id, linkedTabId]);
  useClubEvent(['cafe_items', 'cafe_order_items', 'open_tabs'], load);

  async function add(id: number) {
    if (linkedTabId) await window.api.openTabCafe.add(linkedTabId, id, 1);
    else await window.api.cafeOrder.addToUnit(unit.id, id, 1);
  }
  async function changeQty(id: number, delta: number) {
    if (linkedTabId) await window.api.openTabCafe.changeQty(id, delta);
    else await window.api.cafeOrder.changeQty(id, delta);
  }
  async function remove(id: number) {
    if (linkedTabId) await window.api.openTabCafe.remove(id);
    else await window.api.cafeOrder.removeItem(id);
  }

  const total = tab.reduce((s, i) => s + i.qty * i.unit_price, 0);

  return (
    <Modal title={`سفارش کافه — ${unit.name}`} onClose={onClose} width={560}>
      <div className="pos-grid">
        {items.map((it) => (
          <button key={it.id} className="pos-item" onClick={() => add(it.id)} disabled={it.stock <= 0}>
            <span>{it.name}</span>
            <span className="pos-item-price">{it.price.toLocaleString('fa-IR')}</span>
          </button>
        ))}
      </div>
      <div className="pos-tab">
        <h4>سبد فعلی میز (قابل ویرایش)</h4>
        {tab.length === 0 && <p className="pos-empty">هنوز آیتمی اضافه نشده</p>}
        {tab.map((row) => (
          <div className="pos-tab-row" key={row.id}>
            <span className="pos-tab-name">{row.name}</span>
            <div className="cafe-cart-qty">
              <button onClick={() => changeQty(row.id, -1)}>−</button>
              <span>{row.qty}</span>
              <button onClick={() => changeQty(row.id, 1)}>+</button>
            </div>
            <span>{(row.qty * row.unit_price).toLocaleString('fa-IR')}</span>
            <button className="pos-tab-remove" onClick={() => remove(row.id)}>
              حذف
            </button>
          </div>
        ))}
        {tab.length > 0 && (
          <div className="pos-tab-total">
            <span>جمع</span>
            <span>{total.toLocaleString('fa-IR')} تومان</span>
          </div>
        )}
      </div>
      <div className="checkout-actions">
        <Button variant="primary" onClick={onClose}>
          ثبت
        </Button>
      </div>
    </Modal>
  );
}
