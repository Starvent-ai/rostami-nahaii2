import { useEffect, useState } from 'react';
import { Button } from './Button';
import './PinLock.css';

interface PinApi {
  isSet: () => Promise<boolean>;
  check: (pin: string) => Promise<boolean>;
}

export function PinLock({
  children,
  pinApi,
  title = 'قفل تنظیمات',
  subtitle = 'برای ورود به تنظیمات، رمز عبور را وارد کنید',
}: {
  children: React.ReactNode;
  /** Defaults to the تنظیمات-section PIN so existing call sites are unaffected. */
  pinApi?: PinApi;
  title?: string;
  subtitle?: string;
}) {
  const api = pinApi ?? window.api.settingsPin;
  const [required, setRequired] = useState<boolean | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    api.isSet().then(setRequired);
    // Re-check whenever the pinApi identity changes (e.g. switching between
    // the settings lock and the reports/accounting lock in the same app).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  async function submit() {
    const ok = await api.check(pin);
    if (ok) {
      setUnlocked(true);
      setError(false);
    } else {
      setError(true);
      setPin('');
    }
  }

  if (required === null) return null;
  if (!required || unlocked) return <>{children}</>;

  return (
    <div className="pinlock-wrap">
      <div className="pinlock-panel">
        <div className="pinlock-title">{title}</div>
        <p className="pinlock-subtitle">{subtitle}</p>
        <input
          className="pinlock-input"
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          autoFocus
          placeholder="••••"
        />
        {error && <div className="pinlock-error">رمز اشتباه است</div>}
        <Button variant="primary" onClick={submit} disabled={pin.length < 4}>
          ورود
        </Button>
      </div>
    </div>
  );
}
