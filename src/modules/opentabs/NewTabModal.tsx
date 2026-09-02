import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import '../checkout/CheckoutModal.css';
import './opentabs.css';

export function NewTabModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [customerName, setCustomerName] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const id = await window.api.openTabs.create({
        customerName: customerName.trim() || undefined,
        note: note.trim() || undefined,
      });
      onCreated(id);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="حساب جدید" onClose={onClose} width={420}>
      <input
        className="checkout-input"
        placeholder="نام مشتری (اختیاری)"
        value={customerName}
        onChange={(e) => setCustomerName(e.target.value)}
      />
      <textarea
        className="checkout-input opentabs-note"
        placeholder="توضیحات (اختیاری)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
      />
      <p className="settings-hint" style={{ marginTop: 0 }}>
        اگر نامی وارد نکنید، حساب به‌طور خودکار با نامی مثل «مهمان ۱» ساخته می‌شود.
      </p>
      <div className="checkout-actions">
        <Button variant="primary" disabled={saving} onClick={save}>
          ایجاد حساب
        </Button>
        <Button variant="ghost" onClick={onClose}>
          انصراف
        </Button>
      </div>
    </Modal>
  );
}
