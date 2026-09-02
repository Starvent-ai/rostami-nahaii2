import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { formatDuration } from '../../lib/format';
import { toman } from '../../lib/persian';
import '../checkout/CheckoutModal.css';

interface UnitLite {
  id: number;
  name: string;
  linked_tab_title?: string | null;
}

export function EndToTabModal({ unit, onClose }: { unit: UnitLite; onClose: () => void }) {
  const [calc, setCalc] = useState<{ exactMinutes: number; exactAmount: number; roundedAmount: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      const result = await window.api.units.calcAmount(unit.id);
      if (!cancelled) setCalc(result);
    }
    tick();
    const t = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [unit.id]);

  async function confirm() {
    setSubmitting(true);
    try {
      await window.api.units.endToTab(unit.id);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`پایان بازی — ${unit.name}`} onClose={onClose} width={440}>
      <div className="checkout-summary">
        <div className="checkout-row">
          <span>مدت دقیق بازی</span>
          <span>{calc ? formatDuration(calc.exactMinutes * 60000) : '—'}</span>
        </div>
        <div className="checkout-row">
          <span>هزینه دقیق (تا آخرین تومان)</span>
          <span>{toman(calc?.exactAmount ?? 0)}</span>
        </div>
        <div className="checkout-row checkout-row-rounded">
          <span>مبلغ نهایی (گردشده به ۵٬۰۰۰ تومان)</span>
          <span>{toman(calc?.roundedAmount ?? 0)}</span>
        </div>
        <div className="checkout-row total">
          <span>اضافه می‌شود به حساب</span>
          <span>{unit.linked_tab_title ?? ''}</span>
        </div>
      </div>
      <p className="settings-hint" style={{ marginTop: 0 }}>
        این هزینه بلافاصله پرداخت نمی‌شود — به حساب باز مشتری اضافه می‌شود و در پایان با کل حساب تسویه خواهد شد.
      </p>
      <div className="checkout-actions">
        <Button variant="primary" disabled={submitting} onClick={confirm}>
          افزودن به حساب
        </Button>
        <Button variant="ghost" onClick={onClose}>
          انصراف
        </Button>
      </div>
    </Modal>
  );
}
