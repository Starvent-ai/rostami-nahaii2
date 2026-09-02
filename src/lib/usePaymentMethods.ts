import { useState } from 'react';
import { useClubEvent } from './useClubEvent';

const ALL_METHODS = ['card', 'cardTransfer', 'cash', 'credit'] as const;
export type PaymentMethodKey = (typeof ALL_METHODS)[number];

/** Returns the payment methods enabled in Settings (defaults to all four). */
export function useEnabledPaymentMethods(): PaymentMethodKey[] {
  const [enabled, setEnabled] = useState<PaymentMethodKey[]>([...ALL_METHODS]);

  const load = async () => {
    const s = await window.api.settings.getAll();
    try {
      const parsed = s.payment_methods_enabled ? JSON.parse(s.payment_methods_enabled) : ALL_METHODS;
      setEnabled(parsed.length ? parsed : [...ALL_METHODS]);
    } catch {
      setEnabled([...ALL_METHODS]);
    }
  };

  useClubEvent(['settings'], load);

  return enabled;
}
