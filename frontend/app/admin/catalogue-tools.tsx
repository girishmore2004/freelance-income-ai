'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatMinor } from '@/lib/listing-format';
import type { ServicePackage } from '@/lib/services';

/**
 * Staff tools for the catalogue (U18): open or close work categories (admins;
 * closing needs a reason, everything logged) and review services held by the
 * screen or by a report (moderators and admins; never your own).
 */

type Category = { slug: string; name: string; enabled: boolean; projects: number };
type HeldService = { id: string; title: string; description: string; category_slug: string; packages: ServicePackage[]; moderation_note: string; own: boolean };

const messageOf = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

export function CategoriesPanel() {
  const [items, setItems] = useState<Category[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Category[]; can_manage: boolean }>('/api/v1/admin/categories');
      setItems(Array.isArray(r.items) ? r.items : []);
      setCanManage(Boolean(r.can_manage));
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function toggle(c: Category) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/api/v1/admin/categories/${c.slug}`, 'POST', { enabled: !c.enabled, note: notes[c.slug] ?? '' });
      setNotice(`${c.name} ${c.enabled ? 'closed' : 'opened'}`);
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="categories-heading">
      <h3 id="categories-heading">Work categories</h3>
      <p className="muted small">Open categories can take new projects and services. Closing one keeps existing work; it only stops new posts.</p>
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
      {items && (
        <table>
          <caption className="sr-only">Categories</caption>
          <thead><tr><th scope="col">Category</th><th scope="col">Status</th><th scope="col">Published projects</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
          <tbody>{items.map((c) => (
            <tr key={c.slug}>
              <td>{c.name}</td>
              <td>{c.enabled ? 'Open' : 'Closed'}</td>
              <td>{c.projects}</td>
              <td>{canManage && (
                <div className="field">
                  {c.enabled && <><label className="sr-only" htmlFor={`cnote-${c.slug}`}>Reason for closing {c.name}</label>
                    <input id={`cnote-${c.slug}`} placeholder="Reason to close" maxLength={500} value={notes[c.slug] ?? ''} onChange={(e) => setNotes({ ...notes, [c.slug]: e.target.value })} /></>}
                  <button className="btn" type="button" disabled={busy} onClick={() => void toggle(c)}>{c.enabled ? `Close ${c.name}` : `Open ${c.name}`}</button>
                </div>
              )}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}

export function ServiceModeration() {
  const [items, setItems] = useState<HeldService[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<HeldService[]>('/api/v1/admin/moderation/services');
      setItems(Array.isArray(r) ? r : []);
    } catch (e) {
      // Before migration 0075 the queue is simply empty.
      setItems([]);
      if (!(e instanceof Error && /migration/i.test(e.message))) setError(messageOf(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function decide(s: HeldService, decision: 'approve' | 'return') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/api/v1/admin/moderation/services/${s.id}`, 'POST', { decision, note: notes[s.id] ?? '' });
      setNotice(decision === 'approve' ? `Published: ${s.title}` : `Returned: ${s.title}`);
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="svc-mod-heading">
      <h3 id="svc-mod-heading">Services waiting for review ({items?.length ?? 0})</h3>
      <div aria-live="polite">{notice && <p className="success">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
      {items && items.length === 0 && <p className="empty">Nothing is waiting.</p>}
      <ul>{(items ?? []).map((s) => (
        <li key={s.id} className="card item">
          <b>{s.title}</b> <span className="muted small">{s.category_slug.replace(/_/g, ' ')} · {s.moderation_note || 'held'}</span>
          <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{s.description.slice(0, 600)}</p>
          <p className="muted small">{s.packages.map((p) => `${p.name}: ${formatMinor(p.price_minor, 'INR')}, ${p.delivery_days} days`).join(' · ')}</p>
          {s.own ? <p className="muted small">Your own service: another staff member must review it.</p> : (
            <div className="row">
              <label className="sr-only" htmlFor={`snote-${s.id}`}>Note to the freelancer about {s.title}</label>
              <input id={`snote-${s.id}`} placeholder="Note (needed to return)" maxLength={2000} value={notes[s.id] ?? ''} onChange={(e) => setNotes({ ...notes, [s.id]: e.target.value })} />
              <button className="btn primary" type="button" disabled={busy} onClick={() => void decide(s, 'approve')}>Approve {s.title}</button>
              <button className="btn" type="button" disabled={busy} onClick={() => void decide(s, 'return')}>Return {s.title}</button>
            </div>
          )}
        </li>
      ))}</ul>
    </section>
  );
}
