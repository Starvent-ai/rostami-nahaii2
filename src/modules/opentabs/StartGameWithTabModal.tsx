import { useState } from 'react';
import { toman } from '../../lib/persian';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { ChooseTabFlow } from './ChooseTabFlow';
import '../checkout/CheckoutModal.css';
import './opentabs.css';

interface UnitLite {
  id: number;
  name: string;
  unit_type_kind: 'billiard' | 'ps';
  ps_tier1_price: number;
  ps_tier2_price: number;
  ps_tier3_price: number;
  ps_tier4_price: number;
}

export function StartGameWithTabModal({ unit, onClose }: { unit: UnitLite; onClose: () => void }) {
  const [pendingTabId, setPendingTabId] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);

  async function startNow(tabId: number, tiers?: number) {
    setStarting(true);
    try {
      await window.api.units.start(unit.id, undefined, tiers, tabId);
      onClose();
    } finally {
      setStarting(false);
    }
  }

  async function handleResolved(tabId: number) {
    if (unit.unit_type_kind === 'ps') {
      setPendingTabId(tabId);
    } else {
      await startNow(tabId);
    }
  }

  if (pendingTabId != null) {
    return (
      <TiersStep
        unit={unit}
        busy={starting}
        onConfirm={(tiers) => startNow(pendingTabId, tiers)}
        onBack={() => setPendingTabId(null)}
      />
    );
  }

  return <ChooseTabFlow headerTitle={`شروع بازی با حساب باز — ${unit.name}`} onResolved={handleResolved} onCancel={onClose} />;
}

function TiersStep({
  unit,
  busy,
  onConfirm,
  onBack,
}: {
  unit: UnitLite;
  busy: boolean;
  onConfirm: (tiers: number) => void;
  onBack: () => void;
}) {
  const [tiers, setTiers] = useState(1);
  const tierPrices = [unit.ps_tier1_price, unit.ps_tier2_price, unit.ps_tier3_price, unit.ps_tier4_price];
  const total = tierPrices[tiers - 1] ?? 0;

  return (
    <Modal title={`تعداد دسته — ${unit.name}`} onClose={onBack} width={360}>
      <p className="settings-hint" style={{ marginTop: 0 }}>
        دسته‌ی این بازی را انتخاب کنید — هر دسته قیمت مستقل خودش را دارد
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
        <Button variant="primary" disabled={busy} onClick={() => onConfirm(tiers)}>
          شروع بازی
        </Button>
        <Button variant="ghost" onClick={onBack}>
          بازگشت
        </Button>
      </div>
    </Modal>
  );
}
