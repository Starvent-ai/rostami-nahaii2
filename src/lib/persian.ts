/**
 * All dates in this app must display as Jalali (Shamsi) — never Gregorian.
 * Modern engines support the Persian calendar natively via the
 * 'fa-IR-u-ca-persian' Intl locale, so no extra library is needed.
 */

const dateFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const dateTimeFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const timeFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  hour: '2-digit',
  minute: '2-digit',
});

const longDateFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const shortDayMonthFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  day: 'numeric',
  month: 'short',
});

/** e.g. ۱۰ مرداد — compact label for chart axes. */
export function jalaliShortDayMonth(input: string | number | Date): string {
  return shortDayMonthFmt.format(new Date(input));
}

/** e.g. ۱۴۰۵/۰۵/۱۰ */
export function jalaliDate(input: string | number | Date): string {
  return dateFmt.format(new Date(input));
}

/** e.g. ۱۴۰۵/۰۵/۱۰، ۱۴:۰۵ */
export function jalaliDateTime(input: string | number | Date): string {
  return dateTimeFmt.format(new Date(input));
}

/** e.g. ۱۴:۰۵ */
export function jalaliTime(input: string | number | Date): string {
  return timeFmt.format(new Date(input));
}

/** e.g. شنبه ۱۰ مرداد ۱۴۰۵ — used in the always-visible top-bar clock */
export function jalaliLongDate(input: string | number | Date): string {
  return longDateFmt.format(new Date(input));
}

/** Thousands-grouped Persian-digit number, e.g. ۱۲۳٬۴۵۶ */
export function faNumber(n: number): string {
  return n.toLocaleString('fa-IR');
}

/** Same as faNumber with " تومان" appended, e.g. ۱۲۳٬۴۵۶ تومان */
export function toman(n: number): string {
  return `${faNumber(Math.round(n))} تومان`;
}

/** Rounds a price UP to the nearest 5,000 تومان (never down) — used for time-cost billing. */
export function roundUpTo5000(amount: number): number {
  return Math.ceil(amount / 5000) * 5000;
}
