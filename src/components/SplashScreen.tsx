import { useEffect, useState } from 'react';
import logo from '../assets/starvent-logo-transparent.png';
import './SplashScreen.css';

export function SplashScreen({ onDone }: { onDone: () => void }) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 4600);
    const doneTimer = setTimeout(onDone, 5000);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
  }, [onDone]);

  return (
    <div className={`splash ${fading ? 'splash-out' : ''}`}>
      <div className="splash-center">
        <img src={logo} alt="Starvent" className="splash-logo" />
        <div className="splash-wordmark">Starvent</div>
        <div className="splash-tagline">فراتر از فناوری</div>
      </div>
      <div className="splash-slogan">ما فقط درباره‌ی آینده صحبت نمی‌کنیم؛ ما آینده را می‌سازیم</div>
    </div>
  );
}
