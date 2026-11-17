'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatMinor } from '@/lib/listing-format';

/** Current plan, AI usage and credits (Phase 5). Buying plans opens with payments. */

type Plan = { code: string; name: string; description?: string; price_minor?: number | null; currency?: string; billing_interval?: string; ai_daily_limit: number; ai_monthly_limit: number; features?: string[] };
type MyPlan = { plan: Plan; plan_ends_at: string | null; usage: { today: number; this_month: number }; limits: { daily: number; monthly: number }; credits: number; purchases_available: boolean };

function price(p: Plan): string {
  if (p.price_minor === null || p.price_minor === undefined) return 'Price not set yet';
  if (p.price_minor === 0) return 'Free';
  return `${formatMinor(p.price_minor, p.currency ?? 'INR')} per ${p.billing_interval ?? 'month'}`;
}

export function PlanCard() {
  const [mine, setMine] = useState<MyPlan | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);

  useEffect(() => {
    api<MyPlan>('/api/v1/me/plan').then((m) => { if (m && m.limits && m.usage) setMine(m); }).catch(() => setMine(null));
    api<Plan[]>('/api/v1/plans').then((p) => setPlans(Array.isArray(p) ? p : [])).catch(() => setPlans([]));
  }, []);

  if (!mine) return null;
  const others = plans.filter((p) => p.code !== mine.plan.code);
  return (
    <section className="card" aria-labelledby="plan-heading">
      <h3 id="plan-heading">Plan and AI usage</h3>
      <p><b>{mine.plan.name}</b> · {price(mine.plan)}{mine.plan_ends_at ? ` · until ${new Date(mine.plan_ends_at).toLocaleDateString()}` : ''}</p>
      <p className="muted">AI drafts today: {mine.usage.today} of {mine.limits.daily} · this month: {mine.usage.this_month} of {mine.limits.monthly}{mine.credits > 0 ? ` · ${mine.credits} extra AI credit${mine.credits === 1 ? '' : 's'}` : ''}</p>
      <p className="muted">When a limit is reached, proposals are drafted from templates instead of AI. Extra credits are used only after the monthly limit.</p>
      {others.length > 0 && (
        <>
          <b>Other plans</b>
          <ul>{others.map((p) => <li key={p.code}>{p.name}: {p.ai_daily_limit} AI drafts a day, {p.ai_monthly_limit} a month · {price(p)}</li>)}</ul>
        </>
      )}
      {!mine.purchases_available && <p className="muted">Paid plans and credit packs open when payments are enabled.</p>}
    </section>
  );
}
