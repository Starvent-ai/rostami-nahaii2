import { useEffect, useRef, useState } from 'react';
import { toJalaali, toGregorian, jalaaliMonthLength } from 'jalaali-js';
import './JalaliDatePicker.css';

const MONTH_NAMES = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];
const WEEKDAY_LABELS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

function faDigits(n: number): string {
  return n.toLocaleString('fa-IR');
}

/** JS Date.getDay(): 0=Sunday..6=Saturday. Persian week starts Saturday. */
function jalaliWeekday(gy: number, gm: number, gd: number): number {
  const jsDay = new Date(gy, gm - 1, gd).getDay();
  return (jsDay + 1) % 7; // 0 = شنبه
}

/**
 * A compact Jalali (Shamsi) calendar picker — every date anywhere in this
 * app must be Jalali, so the native (Gregorian) <input type="date"> is never
 * used. value/onChange are plain 'YYYY-MM-DD' Gregorian-ISO strings (what
 * the rest of the app — queries, storage — already works with); only the
 * display and navigation inside this component are Jalali.
 */
export function JalaliDatePicker({ value, onChange }: { value: string; onChange: (isoDate: string) => void }) {
  const [open, setOpen] = useState(false);
  const selectedGregorian = value ? new Date(value + 'T00:00:00') : new Date();
  const selectedJalali = toJalaali(selectedGregorian);
  const [viewYear, setViewYear] = useState(selectedJalali.jy);
  const [viewMonth, setViewMonth] = useState(selectedJalali.jm);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const j = toJalaali(value ? new Date(value + 'T00:00:00') : new Date());
    setViewYear(j.jy);
    setViewMonth(j.jm);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function pick(jd: number) {
    const { gy, gm, gd } = toGregorian(viewYear, viewMonth, jd);
    const iso = `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
    onChange(iso);
    setOpen(false);
  }

  function prevMonth() {
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else {
      setViewMonth((m) => m - 1);
    }
  }
  function nextMonth() {
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  const monthLength = jalaaliMonthLength(viewYear, viewMonth);
  const firstOfMonth = toGregorian(viewYear, viewMonth, 1);
  const firstWeekday = jalaliWeekday(firstOfMonth.gy, firstOfMonth.gm, firstOfMonth.gd);
  const days = Array.from({ length: monthLength }, (_, i) => i + 1);
  const leadingBlanks = Array.from({ length: firstWeekday }, (_, i) => i);

  return (
    <div className="jdp" ref={boxRef}>
      <button type="button" className="jdp-trigger" onClick={() => setOpen((o) => !o)}>
        {value ? `${faDigits(selectedJalali.jy)}/${faDigits(selectedJalali.jm).padStart(2, '۰')}/${faDigits(selectedJalali.jd).padStart(2, '۰')}` : 'انتخاب تاریخ'}
      </button>
      {open && (
        <div className="jdp-popover">
          <div className="jdp-header">
            <button type="button" className="jdp-nav" onClick={nextMonth}>
              ›
            </button>
            <span className="jdp-title">
              {MONTH_NAMES[viewMonth - 1]} {faDigits(viewYear)}
            </span>
            <button type="button" className="jdp-nav" onClick={prevMonth}>
              ‹
            </button>
          </div>
          <div className="jdp-weekdays">
            {WEEKDAY_LABELS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="jdp-grid">
            {leadingBlanks.map((i) => (
              <span key={`b${i}`} />
            ))}
            {days.map((d) => (
              <button
                type="button"
                key={d}
                className={`jdp-day ${d === selectedJalali.jd && viewMonth === selectedJalali.jm && viewYear === selectedJalali.jy ? 'active' : ''}`}
                onClick={() => pick(d)}
              >
                {faDigits(d)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
