'use client';
import { useEffect, useState } from 'react';
import { API_BASE } from '@/lib/api-client';
import { PublicNav } from '../public-nav';

/** Public pricing: only values that have been decided are shown. */

type Plan = { code: string; name: string; description: string; price_minor: number | null; currency: string; billing_interval: string; ai_daily_limit: number; ai_monthly_limit: number; features: string[] };
type Pricing = { plans: Plan[] | null; fees: { status: string; client_fee_bps?: number; freelancer_fee_bps?: number; min_fee_minor?: number; currency?: string }; payments_live: boolean; client_marketplace_open: boolean };

const money = (minor: number, currency: string) => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);

export default function PricingPage() {
  const [data, setData] = useState<Pricing | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/public/pricing`)
      .then((r) => r.json())
      .then((json: { data?: Pricing }) => { if (json && json.data) setData(json.data); else setFailed(true); })
      .catch(() => setFailed(true));
  }, []);

  return (
    <main className="shell">
      <PublicNav />
      <h1>Pricing</h1>
      {failed && <p className="error" role="alert">Pricing could not be loaded. Please try again later.</p>}
      {!data && !failed && <p className="muted">Loading…</p>}
      {data && (
        <>
          <section className="card" aria-labelledby="plans">
            <h2 id="plans">Plans</h2>
            {!data.plans || data.plans.length === 0 ? <p className="muted">Plans are being set up.</p> : (
              <div className="grid">
                {data.plans.map((p) => (
                  <div className="card item" key={p.code}>
                    <h3>{p.name}</h3>
                    <p><b>{p.price_minor === null ? 'Price to be announced' : p.price_minor === 0 ? 'Free' : `${money(p.price_minor, p.currency)} per ${p.billing_interval}`}</b></p>
                    {p.description && <p className="muted">{p.description}</p>}
                    <p>{p.ai_daily_limit} AI drafts a day, up to {p.ai_monthly_limit} a month</p>
                    {p.features.length > 0 && <ul>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>}
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="card" aria-labelledby="fees">
            <h2 id="fees">Marketplace fees</h2>
            {data.fees.status === 'approved' && data.fees.client_fee_bps !== undefined && data.fees.freelancer_fee_bps !== undefined ? (
              <p>Clients pay {(data.fees.client_fee_bps / 100).toFixed(2)}% and freelancers pay {(data.fees.freelancer_fee_bps / 100).toFixed(2)}% of each payment{data.fees.min_fee_minor ? `, with a minimum fee of ${money(data.fees.min_fee_minor, data.fees.currency ?? 'INR')}` : ''}.</p>
            ) : (
              <p>Marketplace fees have not been set yet. They will be published here before payments open.</p>
            )}
            <p className="muted">{data.payments_live ? 'Payments through the platform are live.' : 'Payments through the platform are not live yet; no fees are charged today.'}</p>
          </section>
        </>
      )}
    </main>
  );
}
