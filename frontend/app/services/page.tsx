'use client';
import { SetupWarning } from '../onboarding-ui';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, useSessionToken } from '@/lib/api-client';
import { formatMinor } from '@/lib/listing-format';
import { SERVICE_STATUS, daysLabel, fieldErrors, type PackageKey, type ServicePackage } from '@/lib/services';
import { PublicNav } from '../public-nav';
import { FeeEstimate } from '../contracts/fee-estimate';
import { ReportButton } from '../projects/report-button';
import { ServiceEditor, type MyService } from './service-editor';

/**
 * Services (U18): freelancers sell ready-made packages, clients order one.
 *   /services                 browse (visitors too)
 *   /services?service=<id>    one service with its packages and the order form
 *   /services?view=mine       your services (create, edit, publish, pause)
 * An order becomes a normal contract: the freelancer accepts it, the client
 * funds the milestone (test mode), and delivery, reviews and disputes follow.
 */

type Card = { user_id: string; display_name: string; headline: string; verified?: boolean; rating: { average: number; count: number } | null; newcomer: boolean };
type Item = {
  id: string; title: string; category_slug: string; skills: string[]; packages: ServicePackage[]; from_price_minor: number; fastest_delivery_days: number | null;
  currency: string; freelancer: Card | null; mine: boolean; published_at: string | null;
};
type Detail = Item & { description: string; requirements: string; completed_orders: number; status: string; moderation_note?: string };
type Category = { slug: string; name: string };
type Org = { id: string; name: string; membership_role: string; status: string };

const messageOf = (e: unknown, fallback = 'Something went wrong.') => (e instanceof Error ? e.message : fallback);
const stars = (r: Card['rating']) => (r ? `★ ${r.average} (${r.count})` : 'New');

export default function ServicesPage() {
  const [token] = useSessionToken();
  const [view, setView] = useState<'browse' | 'mine'>('browse');
  const [openId, setOpenId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'mine') setView('mine');
    const s = params.get('service');
    if (s && /^[\w-]{1,64}$/.test(s)) setOpenId(s);
    api<Category[]>('/api/v1/project-categories').then((c) => setCategories(Array.isArray(c) ? c : [])).catch(() => setCategories([]));
  }, []);

  const load = useCallback(async (before: string | null) => {
    try {
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      if (q.trim()) params.set('q', q.trim());
      if (before) params.set('before', before);
      const r = await api<{ items: Item[]; next_before: string | null }>(`/api/v1/services?${params}`);
      setItems((cur) => (before && cur ? [...cur, ...r.items] : r.items));
      setNext(r.next_before);
      setError('');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'FEATURE_DISABLED') setClosed(true);
      else setError(messageOf(e, 'Could not load services.'));
      setItems((cur) => cur ?? []);
    }
  }, [category, q]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === 'browse') void load(null); }, [view, category]);

  function search(e: FormEvent) {
    e.preventDefault();
    void load(null);
  }

  function show(id: string | null) {
    setOpenId(id);
    const url = id ? `/services?service=${encodeURIComponent(id)}` : view === 'mine' ? '/services?view=mine' : '/services';
    window.history.replaceState(null, '', url);
  }

  const catName = (slug: string) => categories.find((c) => c.slug === slug)?.name ?? slug.replace(/_/g, ' ');

  return (
    <main className="shell">
      {!token && <div className="row between" style={{ marginBottom: 12 }}><a href="/" className="row" style={{ gap: 8 }}><span className="logo" aria-hidden="true">F</span><b>Freelance Income AI</b></a><PublicNav /></div>}
      <div className="row between">
        {/* One side per page: clients buy (/services), freelancers sell (/services?view=mine, the freelancer sidebar's "My services"). */}
        {view === 'mine' && token
          ? <div><h2>My services</h2><p className="muted">Sell ready-made work at a fixed price. Clients pick a package and send their requirements; you accept and it becomes a contract.</p></div>
          : <div><h2>Buy a service</h2><p className="muted">Ready-made work at a fixed price. Pick a package, tell the freelancer what you need, and they start once they accept.</p></div>}
      </div>
      {closed && <div className="card"><p className="muted">Services open with the client marketplace.</p></div>}

      {openId ? (
        <ServiceDetail id={openId} signedIn={Boolean(token)} catName={catName} onBack={() => show(null)} />
      ) : view === 'mine' && token ? (
        <MyServices categories={categories} onOpen={show} />
      ) : !closed && (
        <>
          <form className="row" role="search" onSubmit={search}>
            <label htmlFor="sv-q" className="sr-only">Search services</label>
            <input id="sv-q" placeholder="Search: logo, website, SEO…" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} />
            <label htmlFor="sv-cat-filter" className="sr-only">Category</label>
            <select id="sv-cat-filter" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
            <button className="btn" type="submit">Search</button>
          </form>
          {error && <p className="error" role="alert">{error}</p>}
          {items === null ? <p className="muted">Loading services…</p> : items.length === 0 ? <p className="empty">No services here yet. Freelancers: add yours under My services.</p> : (
            <ul className="grid g3" aria-label="Services">
              {items.map((s) => (
                <li key={s.id} className="card item">
                  <span className="badge">{catName(s.category_slug)}</span>
                  <h3 className="small-title">{s.title}</h3>
                  <p className="muted">{s.freelancer?.display_name ?? 'Freelancer'}{s.freelancer?.verified && ' · Reviewed'} · {stars(s.freelancer?.rating ?? null)}</p>
                  <p><b>From {formatMinor(s.from_price_minor, s.currency)}</b>{s.fastest_delivery_days ? <span className="muted"> · delivery from {daysLabel(s.fastest_delivery_days)}</span> : null}</p>
                  <button className="btn" type="button" onClick={() => show(s.id)} aria-label={`View ${s.title}`}>View</button>
                </li>
              ))}
            </ul>
          )}
          {next && <button className="btn" type="button" onClick={() => void load(next)}>Show more</button>}
        </>
      )}
    </main>
  );
}

function ServiceDetail({ id, signedIn, catName, onBack }: { id: string; signedIn: boolean; catName: (s: string) => string; onBack: () => void }) {
  const [s, setS] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [pick, setPick] = useState<PackageKey | null>(null);
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [org, setOrg] = useState('');
  const [requirements, setRequirements] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [orderError, setOrderError] = useState('');
  const [placed, setPlaced] = useState<{ contract_id: string; message: string } | null>(null);

  useEffect(() => {
    api<Detail>(`/api/v1/services/${id}`)
      .then((d) => { setS(d); setPick(d.packages[0]?.key ?? null); })
      .catch((e) => setError(messageOf(e, 'Service not found.')));
    if (signedIn) {
      api<Org[]>('/api/v1/organizations')
        .then((list) => {
          const manageable = (Array.isArray(list) ? list : []).filter((o) => (o.membership_role === 'owner' || o.membership_role === 'admin') && o.status === 'active');
          setOrgs(manageable);
          if (manageable[0]) setOrg(manageable[0].id);
        })
        .catch(() => setOrgs([]));
    }
  }, [id, signedIn]);

  async function order(e: FormEvent) {
    e.preventDefault();
    if (!pick) return;
    setBusy(true);
    setErrors({});
    setOrderError('');
    try {
      const r = await api<{ contract_id: string }>(`/api/v1/services/${id}/order`, 'POST', { organization_id: org, package: pick, requirements });
      setPlaced({ contract_id: r.contract_id, message: 'Order placed. The freelancer accepts it to start; then fund the milestone from the contract.' });
    } catch (err) {
      if (err instanceof ApiError) { setErrors(fieldErrors(err.details)); setOrderError(err.message); } else setOrderError('Could not place the order.');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <section className="card"><p className="error" role="alert">{error}</p><button className="btn" type="button" onClick={onBack}>Back to services</button></section>;
  if (!s) return <p className="muted">Loading…</p>;
  const chosen = s.packages.find((p) => p.key === pick) ?? null;

  return (
    <section aria-label="Service" className="card">
      <button className="link" type="button" onClick={onBack}>← All services</button>
      <span className="badge">{catName(s.category_slug)}</span>
      <h3>{s.title}</h3>
      {s.freelancer && (
        <p className="muted">
          <a className="link" href={`/freelancers?freelancer=${encodeURIComponent(s.freelancer.user_id)}`}>{s.freelancer.display_name}</a>
          {s.freelancer.headline && ` · ${s.freelancer.headline}`}{s.freelancer.verified && ' · Reviewed'} · {stars(s.freelancer.rating)}{s.completed_orders > 0 && ` · ${s.completed_orders} completed order${s.completed_orders === 1 ? '' : 's'}`}
        </p>
      )}
      {s.mine && s.status !== 'published' && <p className="muted">Only you can see this: {SERVICE_STATUS[s.status] ?? s.status}.{s.moderation_note && ` Note: ${s.moderation_note}`}</p>}
      <p style={{ whiteSpace: 'pre-wrap' }}>{s.description}</p>
      {s.skills.length > 0 && <p className="muted">Skills: {s.skills.join(', ')}</p>}

      <div role="radiogroup" aria-label="Packages" className="grid g3">
        {s.packages.map((p) => (
          <label key={p.key} className="card item" style={{ cursor: 'pointer', outline: pick === p.key ? '2px solid currentColor' : undefined }}>
            <input type="radio" name="package" value={p.key} checked={pick === p.key} onChange={() => setPick(p.key)} /> <b>{p.name}</b>
            <div className="metric">{formatMinor(p.price_minor, s.currency)}</div>
            <div className="muted">{daysLabel(p.delivery_days)} delivery · {p.revisions} revision{p.revisions === 1 ? '' : 's'}</div>
            {p.description && <p className="small">{p.description}</p>}
            <ul className="small">{p.deliverables.map((d) => <li key={d}>{d}</li>)}</ul>
          </label>
        ))}
      </div>

      {s.mine ? <p className="muted">This is your service. Clients order it from here.</p> : !signedIn ? (
        <p><a className="btn primary" href="/#signin">Sign in to order</a></p>
      ) : placed ? (
        <div role="status" className="success"><p>{placed.message}</p><a className="btn primary" href={`/contracts#${placed.contract_id}`}>Open the contract</a></div>
      ) : orgs !== null && orgs.length === 0 ? (
        <p className="muted">To order, create a client account first (owners and admins order for it). <a className="link" href="/account">Open Account</a></p>
      ) : (
        <form aria-label="Order this service" onSubmit={order}>
          <h4>Order {chosen ? chosen.name : ''}</h4>
          {orgs && orgs.length > 1 && (
            <div className="field"><label htmlFor="ord-org">Order for client account</label>
              <select id="ord-org" value={org} onChange={(e) => setOrg(e.target.value)}>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          )}
          {s.requirements && <p className="muted">The freelancer asks: {s.requirements}</p>}
          <div className="field"><label htmlFor="ord-req">What you need{s.requirements ? ' (answer the questions above)' : ' (optional)'}</label>
            <textarea id="ord-req" rows={4} maxLength={3000} value={requirements} onChange={(e) => setRequirements(e.target.value)} />
            {errors.requirements && <span className="error small">{errors.requirements}</span>}</div>
          {chosen && <FeeEstimate amountMinor={chosen.price_minor} currency={s.currency} party="client" />}
          {orderError && <p className="error" role="alert">{orderError}</p>}
          <button className="btn primary" type="submit" disabled={busy || !chosen || !org}>{busy ? 'Ordering…' : `Order for ${chosen ? formatMinor(chosen.price_minor, s.currency) : ''}`}</button>
          <p className="muted small">Nothing is charged now. The order becomes a contract the freelancer accepts; payment is per milestone and in test mode until live payments open.</p>
        </form>
      )}
      {signedIn && !s.mine && <ReportButton targetType="service" targetId={s.id} />}
    </section>
  );
}

function MyServices({ categories, onOpen }: { categories: Category[]; onOpen: (id: string) => void }) {
  const [items, setItems] = useState<MyService[] | null>(null);
  const [canSell, setCanSell] = useState(true);
  const [max, setMax] = useState(20);
  const [editing, setEditing] = useState<MyService | 'new' | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: MyService[]; max: number; can_sell: boolean }>('/api/v1/me/services');
      setItems(Array.isArray(r.items) ? r.items : []);
      setMax(r.max ?? 20);
      setCanSell(r.can_sell !== false);
    } catch (e) {
      setError(messageOf(e, 'Could not load your services.'));
      setItems([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(s: MyService, action: 'publish' | 'pause' | 'resume' | 'remove') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await api<MyService & { message?: string }>(`/api/v1/services/${s.id}/transition`, 'POST', { action });
      setNotice(r.status === 'in_review' ? 'A moderator will review this service before it is shown.' : action === 'publish' || action === 'resume' ? 'Live: clients can find and order it.' : action === 'pause' ? 'Paused.' : 'Removed.');
      await load();
    } catch (e) {
      const details = e instanceof ApiError ? Object.values(fieldErrors(e.details)) : [];
      setError(`${messageOf(e)}${details.length ? ` ${details.join(' ')}` : ''}`);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return <ServiceEditor service={editing === 'new' ? null : editing} categories={categories} onCancel={() => setEditing(null)} onSaved={(_s, m) => { setEditing(null); setNotice(m); void load(); }} />;
  }
  return (
    <section aria-label="My services" aria-busy={busy || undefined}>
      <SetupWarning side="freelancer" kind="profile" action="publish anyway" />
      {!canSell && <p className="muted">Use “+ Freelancer” in the top bar to start selling services.</p>}
      <div className="row between"><p className="muted">Up to {max} services. New and edited services are checked; flagged ones wait for a moderator.</p>
        <button className="btn primary" type="button" disabled={!canSell || (items?.length ?? 0) >= max || categories.length === 0} onClick={() => setEditing('new')}>New service</button></div>
      {notice && <p className="success" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {items && items.length === 0 && <p className="empty">You have no services yet. Create one: a clear title, what the client gets, and 1–3 packages with prices.</p>}
      <ul>
        {(items ?? []).map((s) => (
          <li key={s.id} className="card item">
            <div className="row between"><b>{s.title}</b><span className="badge">{SERVICE_STATUS[s.status] ?? s.status}</span></div>
            <p className="muted">From {formatMinor(s.from_price_minor, 'INR')} · {s.packages.length} package{s.packages.length === 1 ? '' : 's'} · {s.orders ?? 0} order{s.orders === 1 ? '' : 's'}{s.open_orders ? ` (${s.open_orders} open)` : ''}</p>
            {s.moderation_note && <p className="muted small">Moderator note: {s.moderation_note}</p>}
            <div className="row">
              <button className="btn" type="button" onClick={() => onOpen(s.id)}>Preview</button>
              {s.status !== 'in_review' && <button className="btn" type="button" onClick={() => setEditing(s)}>Edit</button>}
              {s.status === 'draft' && <button className="btn primary" type="button" disabled={busy} onClick={() => void act(s, 'publish')}>Publish</button>}
              {s.status === 'published' && <button className="btn" type="button" disabled={busy} onClick={() => void act(s, 'pause')}>Pause</button>}
              {s.status === 'paused' && <button className="btn" type="button" disabled={busy} onClick={() => void act(s, 'resume')}>Resume</button>}
              <button className="link" type="button" disabled={busy} onClick={() => void act(s, 'remove')}>Remove</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
