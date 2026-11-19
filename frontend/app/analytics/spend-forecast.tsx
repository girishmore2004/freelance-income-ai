'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatMinor } from '@/lib/listing-format';

/**
 * C7 Spend and Outcomes (U24): money still to come on the client account's
 * active contracts, by the month each milestone is due, with the client fee
 * once a fee schedule is approved. Hourly contracts show their weekly maximum.
 */
type Bucket = { amount_minor: number; fee_minor: number; milestones: number };
type Forecast = {
  months: Array<Bucket & { month: string }>; overdue: Bucket; undated: Bucket; later: Bucket;
  held_minor: number; remaining_fixed_minor: number; remaining_fixed_fee_minor: number;
  hourly_weekly_max_minor: number; hourly_weekly_max_fee_minor: number;
  hourly: Array<{ contract_id: string; title: string; hourly_rate_minor: number; weekly_limit_hours: number }>;
  fee_known: boolean; note: string;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const label = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? m} ${m.slice(0, 4)}`;
const inr = (n: number) => formatMinor(n, 'INR');

export function SpendForecast({ organizationId }: { organizationId: string }) {
  const [data, setData] = useState<Forecast | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setData(null);
    api<Forecast>(`/api/v1/analytics/client/forecast?organization_id=${encodeURIComponent(organizationId)}`)
      .then((f) => setData(f && Array.isArray(f.months) ? f : null))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the forecast.'));
  }, [organizationId]);
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return null;
  const rows = [
    ...(data.overdue.milestones ? [{ key: 'overdue', name: 'Past due date', b: data.overdue }] : []),
    ...data.months.filter((m) => m.milestones).map((m) => ({ key: m.month, name: label(m.month), b: m })),
    ...(data.later.milestones ? [{ key: 'later', name: 'Later', b: data.later }] : []),
    ...(data.undated.milestones ? [{ key: 'undated', name: 'No due date', b: data.undated }] : []),
  ];
  return (
    <section className="card" aria-labelledby="forecast-heading">
      <h3 id="forecast-heading">Spend still to come</h3>
      <p className="muted small">{data.note}</p>
      <div className="stat-grid">
        <div className="card"><small className="muted">Fixed-price milestones not yet paid</small><div className="metric">{inr(data.remaining_fixed_minor + data.remaining_fixed_fee_minor)}</div></div>
        <div className="card"><small className="muted">Already funded, waiting for your approval</small><div className="metric">{inr(data.held_minor)}</div></div>
        <div className="card"><small className="muted">Hourly contracts, at most per week</small><div className="metric">{inr(data.hourly_weekly_max_minor + data.hourly_weekly_max_fee_minor)}</div></div>
      </div>
      {rows.length === 0 ? <p className="empty">Nothing left to fund on fixed-price contracts.</p> : (
        <table>
          <caption className="sr-only">Milestones still to fund, by due month</caption>
          <thead><tr><th scope="col">When due</th><th scope="col">Milestones</th><th scope="col">Price</th><th scope="col">{data.fee_known ? 'Client fee' : 'Fee'}</th><th scope="col">Total</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.key}><td>{r.name}</td><td>{r.b.milestones}</td><td>{inr(r.b.amount_minor)}</td><td>{data.fee_known ? inr(r.b.fee_minor) : 'not set'}</td><td><b>{inr(r.b.amount_minor + r.b.fee_minor)}</b></td></tr>)}</tbody>
        </table>
      )}
      {data.hourly.length > 0 && (
        <ul aria-label="Hourly contracts">{data.hourly.map((h) => <li key={h.contract_id} className="small">{h.title}: {inr(h.hourly_rate_minor)} an hour, up to {h.weekly_limit_hours} hours a week</li>)}</ul>
      )}
    </section>
  );
}
