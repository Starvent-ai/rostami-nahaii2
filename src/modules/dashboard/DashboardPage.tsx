import { useCallback, useEffect, useState } from 'react';
import { useClubEvent } from '../../lib/useClubEvent';
import { jalaliLongDate, jalaliTime, jalaliShortDayMonth } from '../../lib/persian';
import { Card } from '../../components/Card';
import './DashboardPage.css';

export function DashboardPage() {
  const [data, setData] = useState<any | null>(null);
  const [trend, setTrend] = useState<{ date: string; revenue: number }[]>([]);
  const [now, setNow] = useState(new Date());

  const load = useCallback(async () => {
    const from = startOfToday();
    const to = new Date().toISOString();
    setData(await window.api.reports.range(from, to));
    setTrend(await window.api.reports.last7Days());
  }, []);
  useClubEvent(['transactions', 'cafe_order_items'], load);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!data) return null;
  const t = data.totals;
  const maxTrend = Math.max(1, ...trend.map((d) => d.revenue));
  const totalPlayHours = (t.total_play_minutes / 60).toLocaleString('fa-IR', { maximumFractionDigits: 1 });
  const trendPoints = trend.map((d, i) => ({
    x: (i / Math.max(1, trend.length - 1)) * 680 + 10,
    y: 170 - (d.revenue / maxTrend) * 140,
  }));
  const trendPath = smoothSvgPath(trendPoints);

  return (
    <div className="dashboard-page">
      <div className="kpi-grid">
        <Card className="kpi-card">
          <div className="kpi-label">درآمد امروز</div>
          <div className="kpi-value">{t.total_revenue.toLocaleString('fa-IR')}</div>
          <div className="kpi-breakdown">
            <span>نقد {t.cash.toLocaleString('fa-IR')}</span>
            <span>POS {t.card.toLocaleString('fa-IR')}</span>
            <span>حساب دفتری {t.credit.toLocaleString('fa-IR')}</span>
          </div>
        </Card>

        <Card className="kpi-card">
          <div className="kpi-label">سود روزانه (خالص تراکنش‌ها)</div>
          <div className="kpi-value gold">{t.total_revenue.toLocaleString('fa-IR')}</div>
          <div className="kpi-breakdown">
            <span>میزها {t.unit_revenue.toLocaleString('fa-IR')}</span>
            <span>کافه {t.cafe_revenue.toLocaleString('fa-IR')}</span>
          </div>
        </Card>

        <Card className="kpi-card">
          <div className="kpi-label">تعداد فاکتورها</div>
          <div className="kpi-breakdown kpi-breakdown-stacked">
            <span>فاکتور بیلیارد: {data.invoiceCounts.billiard.toLocaleString('fa-IR')}</span>
            <span>فاکتور PS: {data.invoiceCounts.ps.toLocaleString('fa-IR')}</span>
            <span>فاکتور کافه و بوفه: {data.invoiceCounts.cafe.toLocaleString('fa-IR')}</span>
          </div>
        </Card>

        <Card className="kpi-card">
          <div className="kpi-label">{jalaliLongDate(now)}</div>
          <div className="kpi-value">{jalaliTime(now)}</div>
          <div className="kpi-breakdown">
            <span>مجموع ساعت بازی امروز: {totalPlayHours} ساعت</span>
          </div>
        </Card>
      </div>

      <Card>
        <div className="card-header">
          <h3>روند درآمد ۷ روز اخیر</h3>
        </div>
        <div className="revenue-trend-chart">
          <svg viewBox="0 0 700 200" preserveAspectRatio="none" className="revenue-trend-svg">
            <defs>
              <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--gold-300)" stopOpacity="0.35" />
                <stop offset="100%" stopColor="var(--gold-300)" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="trendStroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--gold-500)" />
                <stop offset="100%" stopColor="var(--gold-100)" />
              </linearGradient>
              <filter id="trendGlow" x="-20%" y="-40%" width="140%" height="200%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {[0, 1, 2, 3].map((i) => (
              <line key={i} x1="10" x2="690" y1={20 + i * 45} y2={20 + i * 45} className="trend-gridline" />
            ))}

            {trendPoints.length > 1 && (
              <>
                <path d={`${trendPath} L ${trendPoints[trendPoints.length - 1].x},170 L ${trendPoints[0].x},170 Z`} fill="url(#trendFill)" stroke="none" />
                <path d={trendPath} fill="none" stroke="url(#trendStroke)" strokeWidth="3" strokeLinecap="round" filter="url(#trendGlow)" />
              </>
            )}

            {trendPoints.map((p, i) => (
              <g key={trend[i].date}>
                <circle cx={p.x} cy={p.y} r={i === trendPoints.length - 1 ? 6 : 4} className={i === trendPoints.length - 1 ? 'trend-dot trend-dot-today' : 'trend-dot'} />
                {i === trendPoints.length - 1 && (
                  <text x={p.x} y={p.y - 14} textAnchor="middle" className="trend-today-label">
                    {trend[i].revenue.toLocaleString('fa-IR')}
                  </text>
                )}
              </g>
            ))}
          </svg>
          <div className="revenue-trend-labels">
            {trend.map((d, i) => (
              <span key={d.date} style={{ left: `${(trendPoints[i].x / 700) * 100}%` }}>
                {jalaliShortDayMonth(d.date)}
              </span>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <div className="card-header">
          <h3>درآمد به تفکیک نوع واحد</h3>
        </div>
        <div className="type-bars">
          {data.byUnitType.map((row: any) => {
            const max = Math.max(1, ...data.byUnitType.map((r: any) => r.revenue));
            const pct = Math.round((row.revenue / max) * 100);
            return (
              <div className="type-bar-row" key={row.name}>
                <span className="type-bar-icon">{row.name.includes('PS') ? '🎮' : '🎱'}</span>
                <span className="type-bar-label">{row.name}</span>
                <div className="type-bar-track">
                  <div className="type-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="type-bar-value">{row.revenue.toLocaleString('fa-IR')}</span>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Catmull-Rom → cubic-Bezier smoothing so the trend line reads as a smooth curve, not jagged segments. */
function smoothSvgPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}
