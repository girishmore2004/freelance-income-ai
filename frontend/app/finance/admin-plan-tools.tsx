'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api-client';

/**
 * Admin-only plan tools: list plans, create a draft, activate/retire, give a
 * user a plan, grant AI credits. Hidden for non-admins (the API answers 404).
 */

type Plan = { code: string; name: string; price_minor: number | null; ai_daily_limit: number; ai_monthly_limit: number; status: string };

export function AdminPlanTools() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [draft, setDraft] = useState({ code: '', name: '', daily: '', monthly: '' });
  const [grant, setGrant] = useState({ email: '', plan: 'free' });
  const [credit, setCredit] = useState({ email: '', credits: '', note: '' });
  // One id per intended grant: a retried submit after a network error cannot grant twice.
  const [grantId, setGrantId] = useState(() => crypto.randomUUID());
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await api<Plan[]>('/api/v1/admin/plans');
      setPlans(Array.isArray(rows) ? rows : []);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) setError(e instanceof Error ? e.message : 'Could not load plans.');
      setPlans(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function run(work: () => Promise<{ message?: string }>, after?: () => void) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await work();
      setNotice(result.message ?? 'Saved');
      after?.();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (!plans) return null;
  return (
    <section className="card" aria-labelledby="plans-heading">
      <h3 id="plans-heading">Plans and AI credits (admin)</h3>
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
      <ul>
        {plans.map((p) => (
          <li key={p.code}>
            <b>{p.name}</b> ({p.code}) · {p.ai_daily_limit}/day, {p.ai_monthly_limit}/month · price {p.price_minor === null ? 'not set (D-14)' : p.price_minor / 100} · <span className="badge">{p.status}</span>
            {p.status === 'draft' && <> <button className="btn" disabled={busy} onClick={() => void run(() => api(`/api/v1/admin/plans/${p.code}/status`, 'POST', { status: 'active' }))}>Activate</button></>}
            {p.status === 'active' && p.code !== 'free' && <> <button className="btn" disabled={busy} onClick={() => void run(() => api(`/api/v1/admin/plans/${p.code}/status`, 'POST', { status: 'retired' }))}>Retire</button></>}
          </li>
        ))}
      </ul>

      <form className="row" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => api('/api/v1/admin/plans', 'POST', { code: draft.code, name: draft.name, price_minor: null, ai_daily_limit: Number(draft.daily), ai_monthly_limit: Number(draft.monthly) }), () => setDraft({ code: '', name: '', daily: '', monthly: '' })); }}>
        <div className="field"><label htmlFor="p-code">Plan code</label><input id="p-code" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} /></div>
        <div className="field"><label htmlFor="p-name">Plan name</label><input id="p-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="p-daily">AI per day</label><input id="p-daily" inputMode="numeric" value={draft.daily} onChange={(e) => setDraft({ ...draft, daily: e.target.value })} /></div>
        <div className="field"><label htmlFor="p-monthly">AI per month</label><input id="p-monthly" inputMode="numeric" value={draft.monthly} onChange={(e) => setDraft({ ...draft, monthly: e.target.value })} /></div>
        <button className="btn" type="submit" disabled={busy}>Create draft plan</button>
      </form>

      <form className="row" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => api('/api/v1/admin/plan-grants', 'POST', { email: grant.email, plan_code: grant.plan })); }}>
        <div className="field"><label htmlFor="g-email">User email</label><input id="g-email" type="email" value={grant.email} onChange={(e) => setGrant({ ...grant, email: e.target.value })} /></div>
        <div className="field"><label htmlFor="g-plan">Plan</label>
          <select id="g-plan" value={grant.plan} onChange={(e) => setGrant({ ...grant, plan: e.target.value })}>{plans.filter((p) => p.status === 'active').map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></div>
        <button className="btn" type="submit" disabled={busy}>Give plan</button>
      </form>

      <form className="row" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => api('/api/v1/admin/credit-grants', 'POST', { email: credit.email, credits: Number(credit.credits), note: credit.note, grant_id: grantId }), () => { setCredit({ email: '', credits: '', note: '' }); setGrantId(crypto.randomUUID()); }); }}>
        <div className="field"><label htmlFor="c-email">User email (credits)</label><input id="c-email" type="email" value={credit.email} onChange={(e) => setCredit({ ...credit, email: e.target.value })} /></div>
        <div className="field"><label htmlFor="c-credits">AI credits</label><input id="c-credits" inputMode="numeric" value={credit.credits} onChange={(e) => setCredit({ ...credit, credits: e.target.value })} /></div>
        <div className="field"><label htmlFor="c-note">Note</label><input id="c-note" value={credit.note} maxLength={300} onChange={(e) => setCredit({ ...credit, note: e.target.value })} /></div>
        <button className="btn" type="submit" disabled={busy}>Grant credits</button>
      </form>
    </section>
  );
}
