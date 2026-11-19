'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api-client';

/**
 * Staff tools of the completed platform agents (U24):
 * P1 risk signals (patterns to review, never automatic action),
 * P7 supply-and-demand alerts, P5 source terms and takedowns.
 * Each panel hides itself when the person's role cannot see it.
 */

type Finding = { kind: string; severity: 'high' | 'medium'; summary: string; user_ids: string[]; organization_id: string | null; evidence: string[]; people: Array<{ id: string; name: string }> };
type Risk = { available: boolean; findings: Finding[]; note: string };

const KIND: Record<string, string> = {
  repeated_off_platform: 'Repeated off-platform attempts',
  circular_hiring: 'Accounts hiring each other',
  own_team_contract: 'Contract with own team',
  left_after_first_project: 'Left after the first project',
  many_cancellations: 'Many cancellations or disputes',
};

export function RiskSignalsPanel() {
  const [data, setData] = useState<Risk | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Risk>('/api/v1/admin/risk-signals')
      .then((r) => setData(r && Array.isArray(r.findings) ? r : null))
      .catch((e) => { if (!(e instanceof ApiError && e.status === 404)) setError(e instanceof Error ? e.message : 'Could not load risk signals.'); });
  }, []);
  if (!data && !error) return null;
  return (
    <section className="card" aria-labelledby="risk-heading">
      <h3 id="risk-heading">Risk signals (P1)</h3>
      {error && <p className="error" role="alert">{error}</p>}
      {data && (
        <>
          <p className="muted small">{data.note}</p>
          {!data.available && <p className="notice">Refused contact and payment messages are recorded after database migration 0079.</p>}
          {data.findings.length === 0 ? <p className="empty">No patterns need review.</p> : (
            <ul>
              {data.findings.map((f, i) => (
                <li key={`${f.kind}-${i}`} className="item">
                  <div className="row between"><b>{KIND[f.kind] ?? f.kind}</b><span className={f.severity === 'high' ? 'badge danger' : 'badge'}>{f.severity === 'high' ? 'Review first' : 'Review'}</span></div>
                  <p>{f.summary}</p>
                  <p className="muted small">
                    {f.people.map((p) => <span key={p.id}>{p.name} <code>{p.id}</code>{' '}</span>)}
                    {f.evidence.length > 0 && <> · {f.evidence.join(' · ')}</>}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">Look a person up in Users for their history; suspension and the moderation log work as usual.</p>
        </>
      )}
    </section>
  );
}

type Alert = { kind: string; severity: 'high' | 'medium'; category: string; message: string };
type Balance = { alerts: Alert[]; categories: Array<{ slug: string; name: string; open_projects: number; waiting_projects: number; proposals_30d: number; freelancers_90d: number; services_live: number }>; visible_freelancers: number; note: string };

export function BalanceAlertsPanel() {
  const [data, setData] = useState<Balance | null>(null);
  useEffect(() => {
    api<Balance>('/api/v1/admin/balance-alerts').then((r) => setData(r && Array.isArray(r.alerts) ? r : null)).catch(() => setData(null));
  }, []);
  if (!data) return null;
  return (
    <section className="card" aria-labelledby="balance-heading">
      <h3 id="balance-heading">Marketplace balance (P7)</h3>
      <p className="muted small">{data.visible_freelancers} freelancer{data.visible_freelancers === 1 ? '' : 's'} visible to clients. {data.note}</p>
      {data.alerts.length === 0 ? <p className="empty">Supply and demand look balanced in every category.</p> : (
        <ul>{data.alerts.map((a, i) => <li key={`${a.kind}-${a.category}-${i}`}><span className={a.severity === 'high' ? 'badge danger' : 'badge'}>{a.severity === 'high' ? 'Urgent' : 'Watch'}</span> {a.message}</li>)}</ul>
      )}
      <table>
        <caption className="sr-only">Supply and demand per category</caption>
        <thead><tr><th scope="col">Category</th><th scope="col">Open projects</th><th scope="col">No proposal after 3 days</th><th scope="col">Proposals (30 days)</th><th scope="col">Freelancers (90 days)</th><th scope="col">Services for sale</th></tr></thead>
        <tbody>{data.categories.map((c) => <tr key={c.slug}><td>{c.name}</td><td>{c.open_projects}</td><td>{c.waiting_projects}</td><td>{c.proposals_30d}</td><td>{c.freelancers_90d}</td><td>{c.services_live}</td></tr>)}</tbody>
      </table>
    </section>
  );
}

type Takedown = { id: string; source_code: string; source_url: string; reason: string; removed_count: number; created_at: string };
type SourceTerms = { code: string; label: string; terms: { terms_url: string; permitted_fields: string; reviewed_at: string | null; review_due: boolean } };

export function SourceComplianceTools() {
  const [sources, setSources] = useState<SourceTerms[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [takedowns, setTakedowns] = useState<Takedown[] | null>(null);
  const [code, setCode] = useState('');
  const [termsUrl, setTermsUrl] = useState('');
  const [fields, setFields] = useState('');
  const [tdSource, setTdSource] = useState('');
  const [tdUrl, setTdUrl] = useState('');
  const [tdReason, setTdReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const s = await api<{ can_manage: boolean; items: SourceTerms[] }>('/api/v1/admin/sources');
      setSources(Array.isArray(s?.items) ? s.items.filter((x) => x.terms) : []);
      setCanManage(Boolean(s?.can_manage));
    } catch { setSources([]); }
    try {
      const t = await api<Takedown[]>('/api/v1/admin/source-takedowns');
      setTakedowns(Array.isArray(t) ? t : []);
    } catch { setTakedowns(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const s = sources.find((x) => x.code === code);
    setTermsUrl(s?.terms.terms_url ?? '');
    setFields(s?.terms.permitted_fields ?? '');
  }, [code, sources]);

  async function send(e: FormEvent, fn: () => Promise<unknown>, done: string) {
    e.preventDefault();
    setBusy(true); setError(''); setNotice(''); setFieldErrors({});
    try {
      await fn();
      setNotice(done);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.details[0] && typeof err.details[0] === 'object') setFieldErrors(err.details[0] as Record<string, string>);
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally { setBusy(false); }
  }

  // Shown only with the real sources list (staff); the takedown form needs it to pick a source.
  if (!sources.length) return null;
  const due = sources.filter((s) => s.terms.review_due);
  return (
    <section className="card" aria-labelledby="compliance-heading">
      <h3 id="compliance-heading">Source terms and takedowns (P5)</h3>
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
      {sources.length > 0 && (
        <p className="muted small">{due.length ? `Terms review due for: ${due.map((s) => s.label).join(', ')}.` : 'Every source’s terms were reviewed in the last 180 days.'}</p>
      )}
      {canManage && sources.length > 0 && (
        <form aria-label="Record source terms" onSubmit={(e) => void send(e, () => api(`/api/v1/admin/sources/${code}/terms`, 'POST', { terms_url: termsUrl, permitted_fields: fields, reviewed: true }), 'Terms recorded and marked reviewed.')}>
          <div className="row">
            <div className="field"><label htmlFor="terms-source">Source</label>
              <select id="terms-source" value={code} onChange={(e) => setCode(e.target.value)}>
                <option value="">Choose a source</option>
                {sources.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="terms-url">Terms page</label><input id="terms-url" type="url" value={termsUrl} onChange={(e) => setTermsUrl(e.target.value)} placeholder="https://…" />{fieldErrors.terms_url && <span className="error small">{fieldErrors.terms_url}</span>}</div>
          </div>
          <div className="field"><label htmlFor="terms-fields">Fields we may show</label><input id="terms-fields" maxLength={500} value={fields} onChange={(e) => setFields(e.target.value)} placeholder="title, company, link" /></div>
          <button className="btn" type="submit" disabled={busy || !code}>Save terms and mark reviewed</button>
        </form>
      )}
      {takedowns !== null && (
        <>
          <form aria-label="Take down a listing" onSubmit={(e) => void send(e, () => api('/api/v1/admin/source-takedowns', 'POST', { source_code: tdSource, source_url: tdUrl, reason: tdReason }), 'Listing taken down; it will not be collected again.')}>
            <h4>Take down a listing</h4>
            <div className="row">
              <div className="field"><label htmlFor="td-source">Source</label>
                <select id="td-source" value={tdSource} onChange={(e) => setTdSource(e.target.value)}>
                  <option value="">Choose a source</option>
                  {sources.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                </select>
                {fieldErrors.source_code && <span className="error small">{fieldErrors.source_code}</span>}
              </div>
              <div className="field"><label htmlFor="td-url">Listing link</label><input id="td-url" type="url" value={tdUrl} onChange={(e) => setTdUrl(e.target.value)} />{fieldErrors.source_url && <span className="error small">{fieldErrors.source_url}</span>}</div>
            </div>
            <div className="field"><label htmlFor="td-reason">Who asked and why</label><input id="td-reason" maxLength={1000} value={tdReason} onChange={(e) => setTdReason(e.target.value)} />{fieldErrors.reason && <span className="error small">{fieldErrors.reason}</span>}</div>
            <button className="btn" type="submit" disabled={busy}>Take down</button>
          </form>
          {takedowns.length > 0 && (
            <ul aria-label="Takedowns">{takedowns.map((t) => <li key={t.id} className="small">{t.source_code} · <code>{t.source_url}</code> · {t.reason} · {t.removed_count} hidden · {new Date(t.created_at).toLocaleDateString()}</li>)}</ul>
          )}
        </>
      )}
    </section>
  );
}
