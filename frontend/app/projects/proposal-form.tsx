'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { PROPOSAL_LABELS, formatMinor } from '@/lib/listing-format';
import { safeHref } from '@/lib/safe-url';
import { EMPTY_FORM, buildPayload, formFrom, scopeSummary, type StudioForm, type StudioSections } from '@/lib/proposal-studio';

/**
 * Proposal Studio for client-posted projects (Master Plan p.48, spec §5).
 * Write → Check → Review the exact text → Send. The AI may draft an
 * introduction from confirmed profile facts; deterministic checks flag
 * unsupported claims and price/timeline problems. Sending carries the hash of
 * the exact content reviewed, and every saved change becomes a new version.
 */

type Proposal = {
  id: string; listing_id: string; status: string; cover_letter: string; price_minor: number; currency: string; budget_model: string;
  estimated_days: number | null; project_title: string; listing_status: string; contract_id: string | null; contract_status: string | null;
  sections?: StudioSections | null; current_version?: number; revision_requested_at?: string | null; revision_note?: string | null;
};
type Finding = { code: string; severity: 'warn' | 'info'; field: string; message: string };
type Check = { content_hash: string; findings: Finding[]; evidence_suggestions: Array<{ url: string; matched: string[] }> };
type Version = { version: number; price_minor: number; estimated_days: number | null; created_at: string; changes: string[] };

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <><b>{title}</b><ul>{items.map((i) => <li key={i}>{i}</li>)}</ul></>;
}

/** Read-only view of a proposal's sections, used in the preview and by clients. */
export function SectionsView({ sections, currency }: { sections: StudioSections; currency: string }) {
  return (
    <div>
      {sections.understanding && <><b>Understanding of the project</b><p style={{ whiteSpace: 'pre-wrap' }}>{sections.understanding}</p></>}
      {sections.approach && <><b>Proposed approach</b><p style={{ whiteSpace: 'pre-wrap' }}>{sections.approach}</p></>}
      {sections.evidence.length > 0 && (
        <><b>Portfolio evidence</b><ul>{sections.evidence.map((e) => <li key={e.url}><a className="link" href={safeHref(e.url)} target="_blank" rel="noopener noreferrer nofollow">{e.url}</a>{e.note ? ` — ${e.note}` : ''}</li>)}</ul></>
      )}
      <List title="Deliverables" items={sections.deliverables} />
      {sections.milestones.length > 0 && <><b>Milestones</b><ol>{sections.milestones.map((m) => <li key={m.title}>{m.title} — {formatMinor(m.amount_minor, currency)}</li>)}</ol></>}
      <List title="Assumptions" items={sections.assumptions} />
      <List title="Not included" items={sections.exclusions} />
      <List title="Questions for the client" items={sections.questions} />
      {sections.revision_rounds !== null && <p className="muted">Revision rounds included: {sections.revision_rounds}</p>}
    </div>
  );
}

export function ProposalForm({ listingId, budgetModel, existing, onDone, onCancel }: {
  listingId: string;
  budgetModel: string;
  existing?: Proposal;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<StudioForm>(existing ? formFrom(existing) : EMPTY_FORM);
  const [links, setLinks] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<Check | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [studioOff, setStudioOff] = useState(false);
  const id = existing?.id ?? listingId;
  const currency = existing?.currency ?? 'INR';

  useEffect(() => {
    api<{ portfolio_links?: string[] }>('/api/v1/profile')
      .then((p) => setLinks(Array.isArray(p?.portfolio_links) ? p.portfolio_links.filter((l) => typeof l === 'string') : []))
      .catch(() => setLinks([]));
  }, []);

  function update<K extends keyof StudioForm>(key: K, value: StudioForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setCheck(null);
    setConfirmed(false);
  }

  function showErrors(e: unknown) {
    if (e instanceof ApiError && e.code === 'INVALID_PROPOSAL') {
      const details = e.details[0];
      setErrors(details && typeof details === 'object' ? (details as Record<string, string>) : {});
      setError('Check the highlighted fields.');
    } else setError(messageOf(e));
  }

  async function draft() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const price = buildPayload({ ...form, cover: 'x' });
      const r = await api<{ cover_letter: string; mode: string; ai_note: string | null }>(`/api/v1/marketplace/listings/${listingId}/proposal-draft`, 'POST', price.ok ? { price_minor: price.payload.price_minor } : {});
      update('cover', r.cover_letter);
      setNotice(r.mode === 'model'
        ? 'AI draft added from your confirmed profile. Check every sentence and remove anything that is not true.'
        : `A starting template was added${r.ai_note ? ` (${r.ai_note})` : ''}. Rewrite it in your own words.`);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function review(event: FormEvent) {
    event.preventDefault();
    setError('');
    setNotice('');
    setErrors({});
    const built = buildPayload(form);
    if (!built.ok) { setErrors(built.errors); setError('Check the highlighted fields.'); return; }
    setBusy(true);
    try {
      setCheck(await api<Check>(`/api/v1/marketplace/listings/${listingId}/proposal-check`, 'POST', built.payload));
      setStudioOff(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'MIGRATION_PENDING') {
        setStudioOff(true);
        setCheck({ content_hash: '', findings: [], evidence_suggestions: [] });
        setNotice('Checks and version history switch on after a database update. You can still send the introduction, price and days.');
      } else showErrors(e);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const built = buildPayload(studioOff ? { ...EMPTY_FORM, cover: form.cover, price: form.price, days: form.days } : form);
    if (!built.ok || !check) return;
    setBusy(true);
    setError('');
    const payload = studioOff ? built.payload : { ...built.payload, approved_hash: check.content_hash };
    try {
      if (existing) await api(`/api/v1/listing-proposals/${existing.id}`, 'PUT', payload);
      else await api(`/api/v1/marketplace/listings/${listingId}/proposals`, 'POST', payload);
      onDone(existing ? 'Proposal saved as a new version' : 'Proposal sent');
    } catch (e) {
      setCheck(null);
      setConfirmed(false);
      showErrors(e);
    } finally {
      setBusy(false);
    }
  }

  const err = (key: string) => (errors[key] ? <p className="error" id={`${key.replace(/\./g, '-')}-${id}-error`}>{errors[key]}</p> : null);
  const built = check ? buildPayload(studioOff ? { ...EMPTY_FORM, cover: form.cover, price: form.price, days: form.days } : form) : null;
  const preview = built && built.ok ? built.payload : null;
  const warnings = check?.findings.filter((f) => f.severity === 'warn') ?? [];
  const tips = check?.findings.filter((f) => f.severity === 'info') ?? [];
  const evidenceUrls = new Set(form.evidence.map((e) => e.url));
  const suggested = check?.evidence_suggestions.length ? check.evidence_suggestions.map((s) => s.url) : links;

  return (
    <form className="card" onSubmit={(e) => void review(e)} noValidate aria-label="Proposal">
      <div className="row between">
        <b>Proposal Studio</b>
        <button className="btn" type="button" disabled={busy} onClick={() => void draft()}>Draft introduction with AI</button>
      </div>
      <p className="muted small">AI drafts use only facts on your profile. You edit, check and approve the exact text; nothing is sent automatically.</p>
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}</div>
      <div className="field">
        <label htmlFor={`cover-${id}`}>Introduction: how you would do the work (50–5,000 characters)</label>
        <textarea id={`cover-${id}`} rows={6} maxLength={5000} value={form.cover} onChange={(e) => update('cover', e.target.value)} aria-invalid={Boolean(errors.cover_letter)} />
        {err('cover_letter')}
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor={`price-${id}`}>Your price (₹){budgetModel === 'hourly' ? ' per hour' : ''}</label>
          <input id={`price-${id}`} inputMode="decimal" value={form.price} onChange={(e) => update('price', e.target.value)} aria-invalid={Boolean(errors.price_minor)} />
          {err('price_minor')}
        </div>
        <div className="field">
          <label htmlFor={`days-${id}`}>Estimated days (optional)</label>
          <input id={`days-${id}`} type="number" min={1} max={730} value={form.days} onChange={(e) => update('days', e.target.value)} />
          {err('estimated_days')}
        </div>
      </div>

      <details open={Boolean(existing?.sections)}>
        <summary>Structured sections (recommended): approach, deliverables, milestones, assumptions</summary>
        <div className="field"><label htmlFor={`und-${id}`}>Your understanding of the project</label><textarea id={`und-${id}`} rows={3} maxLength={2000} value={form.understanding} onChange={(e) => update('understanding', e.target.value)} />{err('sections.understanding')}</div>
        <div className="field"><label htmlFor={`app-${id}`}>Proposed approach</label><textarea id={`app-${id}`} rows={4} maxLength={4000} value={form.approach} onChange={(e) => update('approach', e.target.value)} />{err('sections.approach')}</div>
        <div className="field"><label htmlFor={`del-${id}`}>Deliverables (one per line)</label><textarea id={`del-${id}`} rows={3} value={form.deliverables} onChange={(e) => update('deliverables', e.target.value)} />{err('sections.deliverables')}</div>
        <div className="field"><label htmlFor={`ms-${id}`}>Milestones (one per line: Title | amount in ₹)</label><textarea id={`ms-${id}`} rows={3} placeholder={'Design | 10000\nBuild and launch | 20000'} value={form.milestones} onChange={(e) => update('milestones', e.target.value)} />{err('sections.milestones')}</div>
        <div className="field"><label htmlFor={`as-${id}`}>Assumptions (one per line)</label><textarea id={`as-${id}`} rows={2} value={form.assumptions} onChange={(e) => update('assumptions', e.target.value)} />{err('sections.assumptions')}</div>
        <div className="field"><label htmlFor={`ex-${id}`}>Not included (one per line)</label><textarea id={`ex-${id}`} rows={2} value={form.exclusions} onChange={(e) => update('exclusions', e.target.value)} />{err('sections.exclusions')}</div>
        <div className="field"><label htmlFor={`q-${id}`}>Questions for the client (one per line)</label><textarea id={`q-${id}`} rows={2} value={form.questions} onChange={(e) => update('questions', e.target.value)} />{err('sections.questions')}</div>
        <div className="field"><label htmlFor={`rev-${id}`}>Revision rounds included (optional)</label><input id={`rev-${id}`} type="number" min={0} max={10} value={form.revisions} onChange={(e) => update('revisions', e.target.value)} />{err('sections.revision_rounds')}</div>
        <fieldset>
          <legend>Portfolio evidence (links from your profile only)</legend>
          {suggested.length === 0 && <p className="muted small">No portfolio links on your profile yet. Add them under Proposals and applications → Profile.</p>}
          {suggested.map((url) => (
            <label key={url} className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={evidenceUrls.has(url)} onChange={(e) => update('evidence', e.target.checked ? [...form.evidence, { url, note: '' }] : form.evidence.filter((x) => x.url !== url))} />
              <span>{url}</span>
            </label>
          ))}
          {Object.keys(errors).filter((k) => k.startsWith('sections.evidence')).map((k) => <p className="error" key={k}>{errors[k]}</p>)}
        </fieldset>
      </details>
      <p className="muted">Keep contact and payment on the platform. Proposals with phone numbers, emails or payment requests are refused.</p>
      {error && <p className="error" role="alert">{error}</p>}

      {!check && (
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Check and preview'}</button>
          <button className="btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      )}

      {check && preview && (
        <section aria-label="Review before sending" className="card">
          <b>Review before sending</b>
          {warnings.length === 0 && tips.length === 0 && !studioOff && <p className="success">The checks found nothing to fix.</p>}
          {warnings.length > 0 && <><p><b>Fix or confirm</b></p><ul>{warnings.map((f, i) => <li key={`w${i}`} className="error">{f.message}</li>)}</ul></>}
          {tips.length > 0 && <><p><b>Suggestions</b></p><ul>{tips.map((f, i) => <li key={`t${i}`} className="muted">{f.message}</li>)}</ul></>}
          <hr />
          <p className="muted">Exactly what the client will see:</p>
          <p><b>{formatMinor(preview.price_minor, currency)}{budgetModel === 'hourly' ? ' per hour' : ''}</b>{preview.estimated_days ? ` · about ${preview.estimated_days} days` : ''}</p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{preview.cover_letter}</p>
          {preview.sections && <SectionsView sections={preview.sections} currency={currency} />}
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>I reviewed this exact proposal and everything in it is true.</span>
          </label>
          <div className="row">
            <button className="btn primary" type="button" disabled={busy || !confirmed} onClick={() => void send()}>{busy ? 'Sending…' : existing ? 'Save proposal' : 'Send proposal'}</button>
            <button className="btn" type="button" disabled={busy} onClick={() => { setCheck(null); setConfirmed(false); }}>Keep editing</button>
          </div>
        </section>
      )}
    </form>
  );
}

function History({ proposalId, currency }: { proposalId: string; currency: string }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ versions: Version[] }>(`/api/v1/listing-proposals/${proposalId}/versions`)
      .then((r) => setVersions(Array.isArray(r?.versions) ? r.versions : []))
      .catch((e) => setError(messageOf(e)));
  }, [proposalId]);
  if (error) return <p className="error">{error}</p>;
  if (!versions) return <p className="muted">Loading versions…</p>;
  if (!versions.length) return <p className="muted">No version history recorded yet.</p>;
  return (
    <ol reversed aria-label="Version history">
      {versions.map((v) => (
        <li key={v.version}>
          <b>Version {v.version}</b> · {new Date(v.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {formatMinor(v.price_minor, currency)}
          <span className="muted"> — {v.changes.join('; ')}</span>
        </li>
      ))}
    </ol>
  );
}

export { History as ProposalHistory };

export function MyProposals({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<Proposal[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await api<Proposal[]>('/api/v1/me/proposals');
      setItems(Array.isArray(list) ? list : []);
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'FEATURE_DISABLED')) setError(messageOf(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  async function withdraw(p: Proposal) {
    setError('');
    try {
      await api(`/api/v1/listing-proposals/${p.id}/withdraw`, 'POST');
      setNotice('Proposal withdrawn');
      await load();
    } catch (e) {
      setError(messageOf(e));
    }
  }

  if (!items || (items.length === 0 && !error)) return null;
  return (
    <section aria-labelledby="my-proposals-heading">
      <h3 id="my-proposals-heading">Your proposals</h3>
      <div aria-live="polite">
        {notice && <p className="success">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      {items.map((p) => (
        <div className="card item" key={p.id}>
          <div className="row between">
            <b>{p.project_title}</b>
            <span className="row" style={{ gap: 6 }}>
              {(p.current_version ?? 1) > 1 && <span className="badge">Version {p.current_version}</span>}
              <span className="badge">{PROPOSAL_LABELS[p.status] ?? p.status}</span>
            </span>
          </div>
          <p className="muted">{formatMinor(p.price_minor, p.currency)}{p.budget_model === 'hourly' ? ' per hour' : ''}{p.estimated_days ? ` · ${p.estimated_days} days` : ''} · {scopeSummary(p.sections)}</p>
          {p.revision_requested_at && ['submitted', 'shortlisted'].includes(p.status) && (
            <p className="error" role="status">The client asked for a revised proposal: “{p.revision_note}”. Edit it to send a new version.</p>
          )}
          {p.contract_id && <p><a className="link" href="/contracts">{p.contract_status === 'active' ? 'Open your contract' : 'Review the offer'}</a></p>}
          {editing !== p.id && (
            <div className="row">
              {['submitted', 'shortlisted'].includes(p.status) && <button className="btn" onClick={() => setEditing(p.id)}>Edit</button>}
              <button className="btn" aria-expanded={history === p.id} onClick={() => setHistory(history === p.id ? null : p.id)}>History</button>
              {['submitted', 'shortlisted'].includes(p.status) && <button className="btn" onClick={() => void withdraw(p)}>Withdraw</button>}
            </div>
          )}
          {history === p.id && <History proposalId={p.id} currency={p.currency} />}
          {editing === p.id && (
            <ProposalForm
              listingId={p.listing_id}
              budgetModel={p.budget_model}
              existing={p}
              onCancel={() => setEditing(null)}
              onDone={(message) => { setEditing(null); setNotice(message); void load(); }}
            />
          )}
        </div>
      ))}
    </section>
  );
}
