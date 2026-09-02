import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader } from '../../components/Card';
import { Button } from '../../components/Button';
import { JalaliDatePicker } from '../../components/JalaliDatePicker';
import { PinLock } from '../../components/PinLock';
import { toman, jalaliDate, jalaliDateTime } from '../../lib/persian';
import { formatDuration } from '../../lib/format';
import '../checkout/CheckoutModal.css';
import './ReportsPage.css';

type QuickRange = 'day' | 'week' | 'month' | 'year' | 'custom';

// گزارش‌ها shares one PIN with حسابداری (see AccountingPage.tsx) — configured
// once in Settings under "قفل حسابداری و گزارش‌ها".
export function ReportsPage() {
  return (
    <PinLock pinApi={window.api.reportsPin} title="قفل حسابداری و گزارش‌ها" subtitle="برای ورود، رمز عبور را وارد کنید">
      <ReportsPageInner />
    </PinLock>
  );
}

function ReportsPageInner() {
  const [range, setRange] = useState<QuickRange>('day');
  const [customFrom, setCustomFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<any | null>(null);
  const [shiftReport, setShiftReport] = useState<any[]>([]);
  const [tabVisits, setTabVisits] = useState<any[]>([]);
  const [exporting, setExporting] = useState(false);
  const [pdfMsg, setPdfMsg] = useState('');

  async function exportPdf() {
    setExporting(true);
    try {
      const filePath = await window.api.reports.exportPdf();
      setPdfMsg(filePath ? `ذخیره شد: ${filePath}` : '');
    } finally {
      setExporting(false);
      setTimeout(() => setPdfMsg(''), 5000);
    }
  }

  const load = useCallback(async () => {
    const { from, to } = rangeToDates(range, customFrom, customTo);
    const [reportData, shifts, visits] = await Promise.all([
      window.api.reports.range(from, to),
      window.api.shifts.report(from, to),
      window.api.reports.tabVisits(from, to),
    ]);
    setData(reportData);
    setShiftReport(shifts);
    setTabVisits(visits);
  }, [range, customFrom, customTo]);

  useEffect(() => {
    load();
  }, [load]);

  const perEmployee = shiftReport.reduce<Record<string, number>>((acc, s) => {
    acc[s.employee_name] = (acc[s.employee_name] ?? 0) + s.revenue;
    return acc;
  }, {});

  return (
    <div className="reports-page">
      <Card>
        <CardHeader
          title="گزارش‌ها"
          action={
            <div className="reports-range-picker">
              {(['day', 'week', 'month', 'year'] as const).map((r) => (
                <Button key={r} variant={range === r ? 'primary' : 'ghost'} size="sm" onClick={() => setRange(r)}>
                  {{ day: 'روزانه', week: 'هفتگی', month: 'ماهانه', year: 'سالانه' }[r]}
                </Button>
              ))}
              <Button variant={range === 'custom' ? 'primary' : 'ghost'} size="sm" onClick={() => setRange('custom')}>
                بازه دلخواه
              </Button>
              <Button variant="secondary" size="sm" onClick={exportPdf} disabled={exporting}>
                {exporting ? 'در حال ساخت...' : 'خروجی PDF'}
              </Button>
            </div>
          }
        />
        {pdfMsg && <p className="settings-hint-inline" style={{ marginTop: 'var(--space-2)' }}>{pdfMsg}</p>}
        {range === 'custom' && (
          <div className="reports-custom-range">
            <JalaliDatePicker value={customFrom} onChange={setCustomFrom} />
            <span>تا</span>
            <JalaliDatePicker value={customTo} onChange={setCustomTo} />
          </div>
        )}

        {data && (
          <div className="reports-summary">
            <div className="reports-cell">
              <span>جمع فروش</span>
              <strong>{toman(data.totals.total_revenue)}</strong>
            </div>
            <div className="reports-cell">
              <span>درآمد میزها/سیستم‌ها</span>
              <strong>{toman(data.totals.unit_revenue)}</strong>
            </div>
            <div className="reports-cell">
              <span>درآمد کافه</span>
              <strong>{toman(data.totals.cafe_revenue)}</strong>
            </div>
            <div className="reports-cell">
              <span>جمع هزینه‌ها</span>
              <strong className="reports-negative">{toman(data.totals.expense_total)}</strong>
            </div>
            <div className="reports-cell">
              <span>سود و زیان</span>
              <strong className={data.totals.profit < 0 ? 'reports-negative' : ''}>{toman(data.totals.profit)}</strong>
            </div>
            {data.topCustomer && (
              <div className="reports-cell">
                <span>بیشترین مشتری</span>
                <strong>
                  {data.topCustomer.name} ({toman(data.topCustomer.total_spent)})
                </strong>
              </div>
            )}
          </div>
        )}
      </Card>

      {data && (
        <Card>
          <CardHeader title="ساعات شلوغ روز" />
          <div className="reports-hour-chart">
            {Array.from({ length: 24 }, (_, h) => {
              const row = data.byHour.find((r: any) => r.hour === h);
              const count = row?.count ?? 0;
              const max = Math.max(1, ...data.byHour.map((r: any) => r.count));
              return (
                <div key={h} className="reports-hour-bar-wrap" title={`ساعت ${h}: ${count} تراکنش`}>
                  <div className="reports-hour-bar" style={{ height: `${(count / max) * 100}%` }} />
                  <span className="reports-hour-label">{h}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="reports-grid-2">
        {data && (
          <Card>
            <CardHeader title="درآمد به تفکیک نوع میز/سیستم" />
            {data.byUnitType.map((row: any) => (
              <div className="reports-list-row" key={row.name}>
                <span>{row.name}</span>
                <span>{toman(row.revenue)}</span>
              </div>
            ))}
          </Card>
        )}

        {data && (
          <Card>
            <CardHeader title="پرفروش‌ترین محصولات کافه" />
            {data.topCafeItems.length === 0 && <p className="pos-empty">داده‌ای موجود نیست</p>}
            {data.topCafeItems.map((row: any) => (
              <div className="reports-list-row" key={row.name}>
                <span>{row.name}</span>
                <span>{row.qty} عدد</span>
              </div>
            ))}
          </Card>
        )}

        {data && (
          <Card>
            <CardHeader title="درآمد هر میز/سیستم" />
            {data.busiestUnits.map((row: any) => (
              <div className="reports-list-row" key={row.name}>
                <span>{row.name}</span>
                <span>{toman(row.revenue)}</span>
              </div>
            ))}
          </Card>
        )}

        <Card>
          <CardHeader title="فروش هر پرسنل" />
          {Object.keys(perEmployee).length === 0 && <p className="pos-empty">داده‌ای موجود نیست</p>}
          {Object.entries(perEmployee).map(([name, revenue]) => (
            <div className="reports-list-row" key={name}>
              <span>{name}</span>
              <span>{toman(revenue)}</span>
            </div>
          ))}
        </Card>
      </div>

      <Card>
        <CardHeader title="حساب‌های باز — تسویه‌شده در این بازه" />
        {tabVisits.length === 0 && <p className="pos-empty">در این بازه حساب بازی تسویه نشده است</p>}
        {tabVisits.map((v) => (
          <div className="reports-list-row" key={v.id}>
            <span>
              {v.title} — {jalaliDateTime(v.entered_at)} تا {jalaliDateTime(v.exited_at)} ({formatDuration(v.duration_minutes * 60000)})
            </span>
            <span>
              کافه {toman(v.cafe_total)} + بازی {toman(v.unit_total)} = {toman(v.cafe_total + v.unit_total)}
            </span>
          </div>
        ))}
      </Card>
    </div>
  );
}

function rangeToDates(range: QuickRange, customFrom: string, customTo: string) {
  if (range === 'custom') {
    const to = new Date(customTo);
    to.setHours(23, 59, 59, 999);
    return { from: new Date(customFrom).toISOString(), to: to.toISOString() };
  }
  const to = new Date().toISOString();
  const from = new Date();
  if (range === 'day') from.setHours(0, 0, 0, 0);
  else if (range === 'week') from.setDate(from.getDate() - 7);
  else if (range === 'month') from.setDate(from.getDate() - 30);
  else from.setDate(from.getDate() - 365);
  return { from: from.toISOString(), to };
}

// re-exported for potential future use (Jalali-formatted range labels)
export { jalaliDate };
