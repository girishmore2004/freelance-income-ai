'use client';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, useSessionToken } from '@/lib/api-client';
import { CONTRACT_LABELS, formatMinor } from '@/lib/listing-format';
import { TermsForm, type Terms } from './terms-form';
import { ContractWorkspace } from './workspace';

/**
 * Contracts for both parties (Phase 3). An offer becomes active only when the
 * client and the freelancer accepted the same version of the terms. Every
 * change is a new version. Funding milestones is not available yet.
 */

type Version = Terms & {
  version: number; total_minor: number; currency: string; content_hash: string; proposed_by: string; created_at: string;
  client_accepted_at: string | null; freelancer_accepted_at: string | null;
};
type Summary = { id: string; status: string; party: 'client' | 'freelancer'; client_name: string; current_version: number; activated_at: string | null; terms: Version };
type Detail = Summary & { project_title: string; versions: Version[]; allowed_actions: string[]; funding: { available: boolean; message: string } };

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'not yet';
}

export default function ContractsPage() {
  const [token] = useSessionToken();
  const [items, setItems] = useState<Summary[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [changing, setChanging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [closed, setClosed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api<Summary[]>('/api/v1/contracts'));
      setError('');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'FEATURE_DISABLED') setClosed(true);
      else setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (token) void load(); }, [token, load]);

  async function open(id: string) {
    setError('');
    setNotice('');
    setChanging(false);
    try {
      setDetail(await api<Detail>(`/api/v1/contracts/${id}`));
    } catch (e) {
      setError(messageOf(e));
    }
  }

  async function act(path: string, body: Record<string, unknown> | undefined, fallback: string) {
    if (!detail) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<Detail & { message?: string }>(`/api/v1/contracts/${detail.id}/${path}`, 'POST', body);
      setDetail(result);
      setNotice(result.message ?? fallback);
      setChanging(false);
      await load();
    } catch (e) {
      setError(messageOf(e));
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') await open(detail.id);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return <main className="shell"><div className="card"><h2>Contracts</h2><p className="muted">Sign in first to see your contracts.</p><a className="btn" href="/">Go to sign in</a></div></main>;
  }

  const t = detail?.terms;
  return (
    <main className="shell">
      <div className="row between">
        <h2>Contracts</h2>
        <span className="row"><a className="link" href="/projects">Find projects</a><a className="link" href="/client/projects">Client projects</a></span>
      </div>
      <div aria-live="polite">
        {notice && <p className="success">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      {closed && <div className="card"><p className="muted">Contracts open with the client marketplace.</p></div>}
      {loading && <p className="muted">Loading…</p>}
      {!closed && !loading && items.length === 0 && <p className="empty">No contracts yet. Offers you send or receive appear here.</p>}

      {items.map((c) => (
        <div className="card item" key={c.id}>
          <div className="row between">
            <b>{c.terms.title}</b>
            <span className="badge">{CONTRACT_LABELS[c.status] ?? c.status} · v{c.current_version}</span>
          </div>
          <p className="muted">{c.party === 'client' ? 'You are the client' : `Client: ${c.client_name}`} · {formatMinor(c.terms.total_minor, c.terms.currency)}</p>
          <button className="btn" aria-expanded={detail?.id === c.id} onClick={() => (detail?.id === c.id ? setDetail(null) : void open(c.id))}>
            {detail?.id === c.id ? 'Hide' : 'Open'}
          </button>

          {detail?.id === c.id && t && (
            <section aria-label="Contract details">
              <p className="muted">Project: {detail.project_title} · Version {t.version} proposed by the {t.proposed_by}</p>
              {t.scope && <p>{t.scope}</p>}
              {t.deliverables.length > 0 && <><b>Deliverables</b><ul>{t.deliverables.map((d) => <li key={d}>{d}</li>)}</ul></>}
              <table>
                <caption>Milestones</caption>
                <thead><tr><th scope="col">Milestone</th><th scope="col">Amount</th><th scope="col">Due</th></tr></thead>
                <tbody>
                  {t.milestones.map((m, i) => <tr key={i}><td>{m.title}</td><td>{formatMinor(m.amount_minor, t.currency)}</td><td>{m.due_date ?? '—'}</td></tr>)}
                  <tr><th scope="row">Total</th><td><b>{formatMinor(t.total_minor, t.currency)}</b></td><td /></tr>
                </tbody>
              </table>
              <p className="muted">Revision rounds: {t.revision_rounds}</p>
              {t.acceptance_criteria.length > 0 && <><b>Acceptance criteria</b><ul>{t.acceptance_criteria.map((a) => <li key={a}>{a}</li>)}</ul></>}
              {t.ownership_terms && <p className="muted">Ownership: {t.ownership_terms}</p>}
              <p className="muted">Client accepted: {when(t.client_accepted_at)} · Freelancer accepted: {when(t.freelancer_accepted_at)}</p>
              {detail.status === 'active' && <p className="success">Both parties accepted version {t.version}.</p>}
              {detail.status === 'completed' && <p className="success">All milestones approved. This contract is completed.</p>}
              <p className="muted">{detail.funding.message}</p>

              <div className="row">
                {detail.allowed_actions.includes('accept') && (
                  <button className="btn primary" disabled={busy} onClick={() => void act('accept', { version: t.version }, 'Accepted')}>Accept version {t.version}</button>
                )}
                {detail.allowed_actions.includes('propose_changes') && !changing && (
                  <button className="btn" disabled={busy} onClick={() => setChanging(true)}>Propose changes</button>
                )}
                {detail.allowed_actions.includes('decline') && <button className="btn" disabled={busy} onClick={() => void act('decline', undefined, 'Offer declined')}>Decline offer</button>}
                {detail.allowed_actions.includes('withdraw') && <button className="btn" disabled={busy} onClick={() => void act('withdraw', undefined, 'Offer withdrawn')}>Withdraw offer</button>}
              </div>

              {changing && (
                <TermsForm
                  initial={t}
                  submitLabel="Send proposed terms"
                  onCancel={() => setChanging(false)}
                  onSubmit={async (terms) => {
                    // Errors propagate to the form so field errors show next to the inputs.
                    const result = await api<Detail & { message?: string }>(`/api/v1/contracts/${detail.id}/versions`, 'POST', { base_version: t.version, terms });
                    setDetail(result);
                    setNotice(result.message ?? 'New terms proposed');
                    setChanging(false);
                    await load();
                  }}
                />
              )}

              {['offered', 'active', 'completed'].includes(detail.status) && (
                <ContractWorkspace
                  key={`${detail.id}-${detail.status}`}
                  contractId={detail.id}
                  onChanged={() => {
                    void load();
                    api<Detail>(`/api/v1/contracts/${detail.id}`).then((d) => { if (d.status !== detail.status) setDetail(d); }).catch(() => undefined);
                  }}
                />
              )}

              {detail.versions.length > 1 && (
                <>
                  <b>History</b>
                  <ul>{detail.versions.map((v) => <li key={v.version}>v{v.version} by the {v.proposed_by}: {formatMinor(v.total_minor, v.currency)} ({new Date(v.created_at).toLocaleDateString()})</li>)}</ul>
                </>
              )}
            </section>
          )}
        </div>
      ))}
    </main>
  );
}
