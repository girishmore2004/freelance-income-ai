'use client';
import { useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api-client';
import { formatMinor, linesToList, minorToRupees, rupeesToMinor } from '@/lib/listing-format';

/**
 * Contract terms editor, used for a client's offer and for either party's
 * proposed changes. Amounts are typed in rupees, sent as integer paise; the
 * server computes the total again and is the authority.
 */

export type Milestone = { title: string; amount_minor: number; due_date: string | null };
/** Hourly billing (U19): paid per approved week instead of milestones. */
export type Billing = { type: 'fixed' } | { type: 'hourly'; hourly_rate_minor: number; weekly_limit_hours: number };
export type Terms = {
  title: string; scope: string; deliverables: string[]; milestones: Milestone[]; total_minor?: number;
  revision_rounds: number; acceptance_criteria: string[]; ownership_terms: string;
  billing?: Billing;
};

type Row = { title: string; amount: string; due: string };

export function TermsForm({ initial, submitLabel, onSubmit, onCancel, lockBilling = false }: {
  initial: Terms;
  submitLabel: string;
  onSubmit: (terms: Terms) => Promise<void>;
  onCancel: () => void;
  /** Active contracts keep their billing type. */
  lockBilling?: boolean;
}) {
  const startHourly = initial.billing?.type === 'hourly' ? initial.billing : null;
  const [hourly, setHourly] = useState(Boolean(startHourly));
  const [rate, setRate] = useState(startHourly ? minorToRupees(startHourly.hourly_rate_minor) : '');
  const [limit, setLimit] = useState(String(startHourly?.weekly_limit_hours ?? 20));
  const [title, setTitle] = useState(initial.title);
  const [scope, setScope] = useState(initial.scope);
  const [deliverables, setDeliverables] = useState(initial.deliverables.join('\n'));
  const [acceptance, setAcceptance] = useState(initial.acceptance_criteria.join('\n'));
  const [ownership, setOwnership] = useState(initial.ownership_terms);
  const [revisions, setRevisions] = useState(String(initial.revision_rounds));
  const [rows, setRows] = useState<Row[]>(
    initial.milestones.length
      ? initial.milestones.map((m) => ({ title: m.title, amount: minorToRupees(m.amount_minor), due: m.due_date ?? '' }))
      : [{ title: '', amount: '', due: '' }],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const amounts = rows.map((r) => rupeesToMinor(r.amount));
  const total = amounts.every((a) => typeof a === 'number' && !Number.isNaN(a)) ? amounts.reduce<number>((s, a) => s + (a ?? 0), 0) : null;

  function setRow(i: number, patch: Partial<Row>) {
    setRows((current) => current.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const local: Record<string, string> = {};
    const rateMinor = rupeesToMinor(rate);
    if (hourly) {
      if (rateMinor === null || Number.isNaN(rateMinor)) local.billing = 'Enter the hourly rate in rupees.';
    } else {
      rows.forEach((r, i) => {
        const amount = rupeesToMinor(r.amount);
        if (amount === null || Number.isNaN(amount)) local[`milestones.${i}.amount_minor`] = 'Enter an amount in rupees.';
      });
    }
    setErrors(local);
    if (Object.keys(local).length) { setError('Check the highlighted fields.'); return; }
    setBusy(true);
    setError('');
    try {
      await onSubmit({
        title, scope, deliverables: linesToList(deliverables), acceptance_criteria: linesToList(acceptance), ownership_terms: ownership,
        revision_rounds: Number(revisions),
        milestones: hourly ? [] : rows.map((r) => ({ title: r.title.trim(), amount_minor: rupeesToMinor(r.amount) as number, due_date: r.due || null })),
        ...(hourly ? { billing: { type: 'hourly' as const, hourly_rate_minor: rateMinor as number, weekly_limit_hours: Number(limit) } } : {}),
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INVALID_TERMS') {
        const details = e.details[0];
        setErrors(details && typeof details === 'object' ? (details as Record<string, string>) : {});
        setError('Check the highlighted fields.');
      } else setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const err = (key: string) => (errors[key] ? <p className="error">{errors[key]}</p> : null);

  return (
    <form className="card" onSubmit={(e) => void submit(e)} noValidate aria-label="Contract terms">
      <div className="field"><label htmlFor="t-title">Contract title</label><input id="t-title" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />{err('title')}</div>
      <div className="field"><label htmlFor="t-scope">Scope</label><textarea id="t-scope" rows={3} value={scope} maxLength={8000} onChange={(e) => setScope(e.target.value)} />{err('scope')}</div>
      <div className="field"><label htmlFor="t-deliverables">Deliverables (one per line)</label><textarea id="t-deliverables" rows={3} value={deliverables} onChange={(e) => setDeliverables(e.target.value)} />{err('deliverables')}</div>

      <fieldset>
        <legend>How the freelancer is paid</legend>
        <label className="row"><input type="radio" name="billing" checked={!hourly} disabled={lockBilling} onChange={() => setHourly(false)} /> Fixed price, by milestones</label>
        <label className="row"><input type="radio" name="billing" checked={hourly} disabled={lockBilling} onChange={() => setHourly(true)} /> Hourly, paid per approved week</label>
        {lockBilling && <p className="muted small">An active contract keeps its billing type.</p>}
        {hourly && (
          <div className="row">
            <div className="field"><label htmlFor="t-rate">Hourly rate (₹)</label><input id="t-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
            <div className="field"><label htmlFor="t-limit">Weekly limit (hours)</label><input id="t-limit" type="number" min={1} max={80} value={limit} onChange={(e) => setLimit(e.target.value)} /></div>
          </div>
        )}
        {err('billing')}
        {hourly && (() => { const r = rupeesToMinor(rate); return r && !Number.isNaN(r) ? <p className="muted">Most a week can cost: {formatMinor(r * Number(limit || 0), 'INR')} (before fees). The freelancer logs hours; you approve and pay each week.</p> : null; })()}
      </fieldset>

      {!hourly && <fieldset>
        <legend>Milestones</legend>
        {rows.map((r, i) => (
          <div className="row" key={i}>
            <div className="field"><label htmlFor={`m-title-${i}`}>Milestone {i + 1}</label><input id={`m-title-${i}`} value={r.title} maxLength={160} onChange={(e) => setRow(i, { title: e.target.value })} />{err(`milestones.${i}.title`)}</div>
            <div className="field"><label htmlFor={`m-amount-${i}`}>Amount (₹)</label><input id={`m-amount-${i}`} inputMode="decimal" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} />{err(`milestones.${i}.amount_minor`)}</div>
            <div className="field"><label htmlFor={`m-due-${i}`}>Due date</label><input id={`m-due-${i}`} type="date" value={r.due} onChange={(e) => setRow(i, { due: e.target.value })} />{err(`milestones.${i}.due_date`)}</div>
            {rows.length > 1 && <button type="button" className="link" onClick={() => setRows((c) => c.filter((_, j) => j !== i))}>Remove</button>}
          </div>
        ))}
        {err('milestones')}
        {rows.length < 20 && <button type="button" className="btn" onClick={() => setRows((c) => [...c, { title: '', amount: '', due: '' }])}>Add milestone</button>}
        <p className="muted">Total: {total === null ? '—' : formatMinor(total, 'INR')}</p>
      </fieldset>}

      <div className="field"><label htmlFor="t-revisions">Included revision rounds</label><input id="t-revisions" type="number" min={0} max={10} value={revisions} onChange={(e) => setRevisions(e.target.value)} />{err('revision_rounds')}</div>
      <div className="field"><label htmlFor="t-acceptance">Acceptance criteria (one per line)</label><textarea id="t-acceptance" rows={3} value={acceptance} onChange={(e) => setAcceptance(e.target.value)} />{err('acceptance_criteria')}</div>
      <div className="field"><label htmlFor="t-ownership">Ownership and licensing</label><textarea id="t-ownership" rows={2} value={ownership} maxLength={2000} onChange={(e) => setOwnership(e.target.value)} />{err('ownership_terms')}</div>
      {errors.terms && <p className="error">{errors.terms}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Sending…' : submitLabel}</button>
        <button className="btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}
