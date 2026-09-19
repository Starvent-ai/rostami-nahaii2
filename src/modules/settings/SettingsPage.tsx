import { useCallback, useRef, useState } from 'react';
import { useClubEvent } from '../../lib/useClubEvent';
import { toman } from '../../lib/persian';
import { Card, CardHeader } from '../../components/Card';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { PinLock } from '../../components/PinLock';
import { MoneyInput } from '../../components/MoneyInput';
import '../checkout/CheckoutModal.css';
import './SettingsPage.css';

const EMOJI_CHOICES = ['☕', '🥤', '🥪', '🍰', '🍕', '🍔', '🍟', '🍩', '🍫', '🧃', '🍺', '🥗', '🍦', '🍿'];

export function SettingsPage() {
  return (
    <PinLock>
      <div className="settings-page">
        <UnitTypesSection />
        <UnitsSection />
        <CafeCategoriesSection />
        <CafeProductsSection />
        <LedgerCustomersSection />
        <EmployeesSection />
        <PaymentMethodsSection />
        <SecuritySection />
        <AccountingReportsSecuritySection />
        <SystemSection />
      </div>
    </PinLock>
  );
}

function UnitTypesSection() {
  const [types, setTypes] = useState<any[]>([]);
  const load = useCallback(async () => setTypes(await window.api.unitTypes.list()), []);
  useClubEvent(['unit_types'], load);

  const billiard = types.find((t) => t.kind === 'billiard');
  const ps4 = types.find((t) => t.kind === 'ps' && t.name === 'PS4');
  const ps5 = types.find((t) => t.kind === 'ps' && t.name === 'PS5');

  async function updateRate(id: number, field: string, value: string) {
    const n = Number(value);
    if (Number.isNaN(n)) return;
    await window.api.unitTypes.update(id, { [field]: n });
  }

  function PsTiers({ type }: { type: any }) {
    return (
      <>
        <p className="settings-hint" style={{ marginTop: 'var(--space-4)' }}>
          قیمت هر دسته‌ی {type.name} — هر دسته یک نرخ مستقل و جداست؛ هنگام شروع بازی فقط قیمت همان دسته‌ی انتخاب‌شده حساب می‌شود (با دسته‌های دیگر جمع نمی‌شود).
        </p>
        {[1, 2, 3, 4].map((n) => (
          <div className="settings-list-row" key={n}>
            <span className="settings-list-name">دسته {n}</span>
            <MoneyInput
              className="checkout-input settings-inline-input"
              value={String(type[`ps_tier${n}_price`] ?? '')}
              onChange={() => {}}
              onBlur={(digits) => updateRate(type.id, `ps_tier${n}_price`, digits)}
            />
            <span className="settings-hint-inline">تومان/ساعت</span>
          </div>
        ))}
      </>
    );
  }

  return (
    <Card>
      <CardHeader title="انواع میز و سیستم — قیمت‌ها" />

      {billiard && (
        <div className="settings-list-row">
          <span className="settings-list-name">میز بیلیارد</span>
          <MoneyInput
            className="checkout-input settings-inline-input"
            value={String(billiard.hourly_rate ?? '')}
            onChange={() => {}}
            onBlur={(digits) => updateRate(billiard.id, 'hourly_rate', digits)}
          />
          <span className="settings-hint-inline">تومان/ساعت</span>
        </div>
      )}
      {billiard && <TypeImageUploader type={billiard} />}

      {ps4 && <PsTiers type={ps4} />}
      {ps4 && <TypeImageUploader type={ps4} />}
      {ps5 && <PsTiers type={ps5} />}
      {ps5 && <TypeImageUploader type={ps5} />}
    </Card>
  );
}

/** Resizes+compresses a selected image file to a compact JPEG data URL before
 * it's stored on the unit_type row (kept small so unitTypes:list — fetched
 * on every units-page load — never has to carry multi-megabyte blobs). */
function readImageFileCompressed(file: File, maxSide = 640): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('invalid image'));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('canvas unavailable'));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/** Per-type professional photo upload — shown on every card for that type's
 * units (میزها/سیستم‌های موجود از همین نوع خودکار همین تصویر را می‌گیرند).
 * "حالت مشغول" is optional: when unset, the units page shows the same photo
 * with a colored ring instead once a unit of this type starts playing. */
function TypeImageUploader({ type }: { type: any }) {
  const freeInputRef = useRef<HTMLInputElement>(null);
  const playingInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'' | 'free' | 'playing'>('');

  async function handleFile(field: 'image' | 'image_playing', file: File | undefined) {
    if (!file) return;
    setBusy(field === 'image' ? 'free' : 'playing');
    try {
      const dataUrl = await readImageFileCompressed(file);
      await window.api.unitTypes.update(type.id, { [field]: dataUrl });
    } finally {
      setBusy('');
    }
  }

  async function clear(field: 'image' | 'image_playing') {
    await window.api.unitTypes.update(type.id, { [field]: '' });
  }

  return (
    <div className="settings-image-uploader">
      <span className="settings-list-name">تصویر {type.name}</span>
      <div className="settings-image-uploader-slot">
        {type.image ? (
          <img src={type.image} alt="" className="settings-image-thumb" />
        ) : (
          <span className="settings-hint-inline">بدون تصویر (SVG پیش‌فرض)</span>
        )}
        <Button variant="secondary" size="sm" onClick={() => freeInputRef.current?.click()} disabled={busy === 'free'}>
          {busy === 'free' ? 'در حال بارگذاری…' : type.image ? 'تغییر تصویر آزاد' : '+ تصویر حالت آزاد'}
        </Button>
        {type.image && (
          <Button variant="ghost" size="sm" onClick={() => clear('image')}>
            حذف
          </Button>
        )}
        <input
          ref={freeInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => handleFile('image', e.target.files?.[0])}
        />
      </div>
      <div className="settings-image-uploader-slot">
        {type.image_playing ? (
          <img src={type.image_playing} alt="" className="settings-image-thumb" />
        ) : (
          <span className="settings-hint-inline">بدون تصویر جدا (حین بازی همان تصویر بالا با کادر رنگی نشان داده می‌شود)</span>
        )}
        <Button variant="secondary" size="sm" onClick={() => playingInputRef.current?.click()} disabled={busy === 'playing'}>
          {busy === 'playing' ? 'در حال بارگذاری…' : type.image_playing ? 'تغییر تصویر مشغول' : '+ تصویر حالت مشغول (اختیاری)'}
        </Button>
        {type.image_playing && (
          <Button variant="ghost" size="sm" onClick={() => clear('image_playing')}>
            حذف
          </Button>
        )}
        <input
          ref={playingInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => handleFile('image_playing', e.target.files?.[0])}
        />
      </div>
    </div>
  );
}

function UnitsSection() {
  const [units, setUnits] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const load = useCallback(async () => {
    setUnits(await window.api.units.list());
    setTypes(await window.api.unitTypes.list());
  }, []);
  useClubEvent(['units', 'unit_types'], load);

  async function archive(id: number) {
    await window.api.units.archive(id);
  }

  return (
    <Card>
      <CardHeader
        title="میزها و سیستم‌های موجود"
        action={
          <Button variant="secondary" size="sm" onClick={() => setNewOpen(true)}>
            + افزودن میز/سیستم
          </Button>
        }
      />
      <div className="settings-list">
        {units.map((u) => (
          <div className="settings-list-row" key={u.id}>
            <span className="settings-list-name">{u.name}</span>
            <span className="settings-hint-inline">{u.unit_type_name}</span>
            <Button variant="ghost" size="sm" onClick={() => archive(u.id)}>
              حذف
            </Button>
          </div>
        ))}
      </div>
      {newOpen && <NewUnitModal types={types} units={units} onClose={() => setNewOpen(false)} />}
    </Card>
  );
}

function NewUnitModal({ types, units, onClose }: { types: any[]; units: any[]; onClose: () => void }) {
  const [typeId, setTypeId] = useState<number | ''>(types[0]?.id ?? '');
  const selectedType = types.find((t) => t.id === typeId);
  const nextNumber = selectedType ? units.filter((u) => u.unit_type_id === typeId).length + 1 : 1;

  async function save() {
    if (!typeId) return;
    await window.api.units.create({ unit_type_id: typeId });
    onClose();
  }

  return (
    <Modal title="میز/سیستم جدید" onClose={onClose} width={360}>
      <select className="checkout-input" value={typeId} onChange={(e) => setTypeId(Number(e.target.value))}>
        {types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {selectedType && (
        <p className="settings-hint" style={{ marginTop: 0 }}>
          پیش‌نمایش: <strong>{selectedType.name}</strong> — شماره {nextNumber.toLocaleString('fa-IR')}
        </p>
      )}
      <div className="checkout-actions">
        <Button variant="primary" onClick={save}>
          ذخیره
        </Button>
        <Button variant="ghost" onClick={onClose}>
          انصراف
        </Button>
      </div>
    </Modal>
  );
}

function CafeCategoriesSection() {
  const [categories, setCategories] = useState<any[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const load = useCallback(async () => setCategories(await window.api.cafeCategories.list()), []);
  useClubEvent(['cafe_items'], load);

  async function remove(id: number) {
    await window.api.cafeCategories.delete(id);
  }

  return (
    <Card>
      <CardHeader
        title="دسته‌بندی محصولات کافه و بوفه"
        action={
          <Button variant="secondary" size="sm" onClick={() => setNewOpen(true)}>
            + دسته جدید
          </Button>
        }
      />
      <div className="settings-list">
        {categories.map((c) => (
          <div className="settings-list-row" key={c.id}>
            <span style={{ fontSize: 18 }}>{c.emoji}</span>
            <span className="settings-list-name">{c.name}</span>
            <Button variant="ghost" size="sm" onClick={() => remove(c.id)}>
              حذف
            </Button>
          </div>
        ))}
      </div>
      {newOpen && <NewCategoryModal onClose={() => setNewOpen(false)} />}
    </Card>
  );
}

function NewCategoryModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(EMOJI_CHOICES[0]);

  async function save() {
    if (!name.trim()) return;
    await window.api.cafeCategories.create(name.trim(), emoji);
    onClose();
  }

  return (
    <Modal title="دسته‌ی جدید" onClose={onClose} width={360}>
      <input className="checkout-input" placeholder="نام دسته" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="settings-emoji-grid">
        {EMOJI_CHOICES.map((em) => (
          <button
            key={em}
            className={`settings-emoji-choice ${emoji === em ? 'active' : ''}`}
            onClick={() => setEmoji(em)}
            type="button"
          >
            {em}
          </button>
        ))}
      </div>
      <div className="checkout-actions">
        <Button variant="primary" onClick={save}>
          ذخیره
        </Button>
        <Button variant="ghost" onClick={onClose}>
          انصراف
        </Button>
      </div>
    </Modal>
  );
}

function CafeProductsSection() {
  const [items, setItems] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const load = useCallback(async () => {
    setItems(await window.api.cafeItems.list());
    setCategories(await window.api.cafeCategories.list());
  }, []);
  useClubEvent(['cafe_items'], load);

  async function updatePrice(id: number, price: string) {
    const n = Number(price);
    if (Number.isNaN(n)) return;
    await window.api.cafeItems.update(id, { price: n });
  }

  async function updateStock(id: number, stock: string) {
    const current = items.find((i) => i.id === id);
    const n = Number(stock);
    if (!current || Number.isNaN(n)) return;
    await window.api.cafeItems.restock(id, n - current.stock);
  }

  async function archive(id: number) {
    await window.api.cafeItems.archive(id);
  }

  return (
    <Card>
      <CardHeader
        title="محصولات کافه و بوفه"
        action={
          <Button variant="secondary" size="sm" onClick={() => setNewOpen(true)}>
            + محصول جدید
          </Button>
        }
      />
      <div className="settings-list">
        {items.map((it) => (
          <div className="settings-list-row" key={it.id}>
            <span className="settings-list-name">{it.name}</span>
            <span className="settings-hint-inline">{it.category}</span>
            <MoneyInput
              className="checkout-input settings-inline-input"
              value={String(it.price ?? '')}
              onChange={() => {}}
              onBlur={(digits) => updatePrice(it.id, digits)}
            />
            <span className="settings-hint-inline">تومان</span>
            <input
              className="checkout-input settings-inline-input"
              type="number"
              defaultValue={it.stock}
              onBlur={(e) => updateStock(it.id, e.target.value)}
            />
            <span className="settings-hint-inline">موجودی</span>
            <Button variant="ghost" size="sm" onClick={() => archive(it.id)}>
              حذف
            </Button>
          </div>
        ))}
      </div>
      {newOpen && <NewCafeProductModal categories={categories} onClose={() => setNewOpen(false)} />}
    </Card>
  );
}

function NewCafeProductModal({ categories, onClose }: { categories: any[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState(categories[0]?.name ?? '');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');

  async function save() {
    if (!name.trim() || !category || !price) return;
    await window.api.cafeItems.create({ name: name.trim(), category, price: Number(price), stock: Number(stock || 0) });
    onClose();
  }

  return (
    <Modal title="محصول جدید" onClose={onClose} width={360}>
      <input className="checkout-input" placeholder="نام محصول" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="checkout-input" value={category} onChange={(e) => setCategory(e.target.value)}>
        {categories.map((c) => (
          <option key={c.id} value={c.name}>
            {c.emoji} {c.name}
          </option>
        ))}
      </select>
      <MoneyInput placeholder="قیمت (تومان)" value={price} onChange={setPrice} />
      <input className="checkout-input" type="number" placeholder="موجودی اولیه" value={stock} onChange={(e) => setStock(e.target.value)} />
      <div className="checkout-actions">
        <Button variant="primary" onClick={save}>
          ذخیره
        </Button>
        <Button variant="ghost" onClick={onClose}>
          انصراف
        </Button>
      </div>
    </Modal>
  );
}

function LedgerCustomersSection() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const load = useCallback(async () => setCustomers(await window.api.customers.list()), []);
  useClubEvent(['customers'], load);

  async function remove(id: number) {
    await window.api.customers.delete(id);
  }

  return (
    <Card>
      <CardHeader
        title="مشتریان حساب دفتری"
        action={
          <Button variant="secondary" size="sm" onClick={() => setNewOpen(true)}>
            + مشتری جدید
          </Button>
        }
      />
      <div className="settings-list">
        {customers.map((c) => (
          <div className="settings-list-row" key={c.id}>
            <span className="settings-list-name">{c.name}</span>
            <span className="settings-hint-inline">{c.phone}</span>
            <span className="settings-hint-inline">{toman(c.balance)}</span>
            <Button variant="ghost" size="sm" onClick={() => remove(c.id)}>
              حذف
            </Button>
          </div>
        ))}
        {customers.length === 0 && <p className="pos-empty">مشتری‌ای ثبت نشده</p>}
      </div>
      {newOpen && <NewCustomerSettingsModal onClose={() => setNewOpen(false)} />}
    </Card>
  );
}

function NewCustomerSettingsModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [initialDebt, setInitialDebt] = useState('');
  const [error, setError] = useState('');

  async function save() {
    if (!name.trim()) return;
    setError('');
    try {
      await window.api.customers.create({ name: name.trim(), phone: phone.trim(), initialDebt: Number(initialDebt || 0) });
      onClose();
    } catch (err: any) {
      // Strip the Electron IPC wrapper ("Error invoking remote method
      // 'customers:create': Error: <message>") down to just <message>.
      // The previous regex assumed the channel name had no colon, but
      // 'customers:create' does — reproduced live: it left the raw
      // "Error invoking remote method 'customers:create': Error: ..."
      // wrapper showing above the real Persian message. Matching greedily
      // up to the LAST "Error:" (rather than stopping at the first colon)
      // works regardless of colons inside the channel name.
      setError(err?.message?.replace(/^.*Error:\s*/, '') || 'خطا در ثبت مشتری');
    }
  }

  return (
    <Modal title="مشتری جدید" onClose={onClose} width={360}>
      <input className="checkout-input" placeholder="نام" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="checkout-input" placeholder="شماره تماس" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <MoneyInput placeholder="بدهی اولیه (تومان) — اختیاری" value={initialDebt} onChange={setInitialDebt} />
      {error && <p className="settings-hint" style={{ color: 'var(--danger)', marginTop: 0 }}>{error}</p>}
      <div className="checkout-actions">
        <Button variant="primary" onClick={save}>
          ذخیره
        </Button>
        <Button variant="ghost" onClick={onClose}>
          انصراف
        </Button>
      </div>
    </Modal>
  );
}

function EmployeesSection() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [name, setName] = useState('');
  const load = useCallback(async () => setEmployees(await window.api.employees.list()), []);
  useClubEvent(['employees'], load);

  async function add() {
    if (!name.trim()) return;
    await window.api.employees.create(name.trim());
    setName('');
  }

  async function remove(id: number) {
    await window.api.employees.delete(id);
  }

  return (
    <Card>
      <CardHeader title="پرسنل" />
      <p className="settings-hint" style={{ marginTop: 0 }}>
        به‌محض ثبت اولین پرسنل، از این پس هر بار برنامه باز شود، صفحه‌ی انتخاب شیفت نمایش داده می‌شود.
      </p>
      <div className="tournament-add-row">
        <input className="checkout-input" style={{ margin: 0 }} placeholder="نام کارمند جدید" value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="secondary" size="sm" onClick={add}>
          افزودن
        </Button>
      </div>
      <div className="settings-list" style={{ marginTop: 'var(--space-3)' }}>
        {employees.map((e) => (
          <div className="settings-list-row" key={e.id}>
            <span className="settings-list-name">{e.name}</span>
            <Button variant="ghost" size="sm" onClick={() => remove(e.id)}>
              حذف
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SecuritySection() {
  const [isSet, setIsSet] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => setIsSet(await window.api.settingsPin.isSet()), []);
  useClubEvent(['settings'], load);

  async function setPin() {
    if (newPin.length < 4) {
      setMsg('رمز باید حداقل ۴ رقم باشد');
      return;
    }
    await window.api.settingsPin.set(newPin);
    setNewPin('');
    setMsg('رمز ذخیره شد');
    setTimeout(() => setMsg(''), 3000);
  }

  async function clearPin() {
    await window.api.settingsPin.clear();
    setMsg('رمز حذف شد');
    setTimeout(() => setMsg(''), 3000);
  }

  return (
    <Card>
      <CardHeader title="قفل تنظیمات" />
      <div className="settings-form-row">
        <label>{isSet ? 'تغییر رمز عبور' : 'تعیین رمز عبور'} (حداقل ۴ رقم)</label>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <input
            className="checkout-input"
            style={{ margin: 0, width: 120 }}
            type="password"
            inputMode="numeric"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
          />
          <Button variant="secondary" size="sm" onClick={setPin}>
            ذخیره
          </Button>
          {isSet && (
            <Button variant="ghost" size="sm" onClick={clearPin}>
              حذف رمز
            </Button>
          )}
        </div>
      </div>
      {msg && <p className="settings-hint-inline">{msg}</p>}
    </Card>
  );
}

function AccountingReportsSecuritySection() {
  const [isSet, setIsSet] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => setIsSet(await window.api.reportsPin.isSet()), []);
  useClubEvent(['settings'], load);

  async function setPin() {
    if (newPin.length < 4) {
      setMsg('رمز باید حداقل ۴ رقم باشد');
      return;
    }
    await window.api.reportsPin.set(newPin);
    setNewPin('');
    setMsg('رمز ذخیره شد');
    setTimeout(() => setMsg(''), 3000);
  }

  async function clearPin() {
    await window.api.reportsPin.clear();
    setMsg('رمز حذف شد');
    setTimeout(() => setMsg(''), 3000);
  }

  return (
    <Card>
      <CardHeader title="قفل حسابداری و گزارش‌ها" />
      <p className="settings-hint-inline">این رمز، جدا از قفل تنظیمات، ورود به صفحات حسابداری و گزارش‌ها را محافظت می‌کند.</p>
      <div className="settings-form-row">
        <label>{isSet ? 'تغییر رمز عبور' : 'تعیین رمز عبور'} (حداقل ۴ رقم)</label>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <input
            className="checkout-input"
            style={{ margin: 0, width: 120 }}
            type="password"
            inputMode="numeric"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
          />
          <Button variant="secondary" size="sm" onClick={setPin}>
            ذخیره
          </Button>
          {isSet && (
            <Button variant="ghost" size="sm" onClick={clearPin}>
              حذف رمز
            </Button>
          )}
        </div>
      </div>
      {msg && <p className="settings-hint-inline">{msg}</p>}
    </Card>
  );
}

function PaymentMethodsSection() {
  const [enabled, setEnabled] = useState<string[]>(['card', 'cardTransfer', 'cash', 'credit']);
  const load = useCallback(async () => {
    const s = await window.api.settings.getAll();
    try {
      setEnabled(s.payment_methods_enabled ? JSON.parse(s.payment_methods_enabled) : ['card', 'cardTransfer', 'cash', 'credit']);
    } catch {
      setEnabled(['card', 'cardTransfer', 'cash', 'credit']);
    }
  }, []);
  useClubEvent(['settings'], load);

  const METHODS: { key: string; label: string }[] = [
    { key: 'card', label: 'POS' },
    { key: 'cardTransfer', label: 'کارت‌به‌کارت' },
    { key: 'cash', label: 'نقدی' },
    { key: 'credit', label: 'حساب دفتری' },
  ];

  async function toggle(key: string) {
    const next = enabled.includes(key) ? enabled.filter((k) => k !== key) : [...enabled, key];
    if (next.length === 0) return; // at least one method must stay enabled
    await window.api.settings.set('payment_methods_enabled', JSON.stringify(next));
  }

  return (
    <Card>
      <CardHeader title="روش‌های پرداخت" />
      {METHODS.map((m) => (
        <div className="settings-form-row" key={m.key}>
          <label>{m.label}</label>
          <input type="checkbox" checked={enabled.includes(m.key)} onChange={() => toggle(m.key)} />
        </div>
      ))}
      <p className="settings-hint">روش‌های غیرفعال در پنجره‌ی تسویه و فروش کافه نمایش داده نمی‌شوند.</p>
    </Card>
  );
}

function SystemSection() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [backupMsg, setBackupMsg] = useState('');
  const load = useCallback(async () => setSettings(await window.api.settings.getAll()), []);
  useClubEvent(['settings'], load);

  async function save(key: string, value: string) {
    await window.api.settings.set(key, value);
  }

  async function backupNow() {
    const path = await window.api.backup.runNow();
    setBackupMsg(path ? 'بکاپ با موفقیت ذخیره شد' : 'بکاپ‌گیری ناموفق بود');
    setTimeout(() => setBackupMsg(''), 4000);
  }

  async function pickBackupFolder() {
    await window.api.backup.pickFolder();
  }

  return (
    <Card>
      <CardHeader title="سیستم" />
      <div className="settings-form-row">
        <label>هشدار بدهکار دیرکرد بعد از (روز)</label>
        <input
          className="checkout-input"
          style={{ margin: 0, width: 100 }}
          type="number"
          defaultValue={settings.overdue_days_warning ?? '15'}
          onBlur={(e) => save('overdue_days_warning', e.target.value)}
        />
      </div>

      <div className="settings-form-row">
        <label>چاپ رسید (thermal printer)</label>
        <span className="settings-disabled-badge">غیرفعال — آماده برای فعال‌سازی بعدی</span>
      </div>

      <div className="settings-form-row">
        <label>مسیر بکاپ‌گیری</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span className="settings-hint-inline">{settings.backup_path || 'مسیر پیش‌فرض'}</span>
          <Button variant="ghost" size="sm" onClick={pickBackupFolder}>
            انتخاب پوشه
          </Button>
        </div>
      </div>

      <div className="settings-form-row">
        <label>بکاپ‌گیری</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Button variant="secondary" size="sm" onClick={backupNow}>
            بکاپ فوری
          </Button>
          {backupMsg && <span className="settings-hint-inline">{backupMsg}</span>}
        </div>
      </div>
      <p className="settings-hint">
        بکاپ به‌صورت خودکار هر بار که اپ بسته می‌شود گرفته می‌شود (نه بر اساس زمان‌بندی ثابت، به‌دلیل قطعی برق روزانه).
        آخرین ۳۰ بکاپ نگه‌داری می‌شود.
      </p>
    </Card>
  );
}
