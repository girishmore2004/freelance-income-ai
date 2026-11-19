'use client';
import { SpendForecast } from './spend-forecast';
import { BalanceAlertsPanel } from '../admin/agent-tools';
import { useMode } from '@/lib/mode';
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, api, useSessionToken } from '@/lib/api-client';
import { formatRate, modeLabel, rupees, sampleNote, type Rate } from '@/lib/analytics-format';
import { BarChart } from './bar-chart';

/**
 * Analytics (Master Plan 4.4, spec §13): three surfaces from Edge data —
 * the freelancer's business, a client organisation's hiring and spend, and
 * marketplace operations for staff. Every number is computed on the server
 * from the viewer's own scope; definitions are shown with the numbers, rates
 * show their sample, and test-mode money is labelled and never mixed with live.
 */

type Series = Array<{ period: string; total: number }>;
type Band = { band: string; proposals: number; success: Rate };
type Freelancer = {
  proposals: { by_month: Array<{ period: string; sent: number; won: number }>; total: number; success_rate: Rate; shortlist_rate: Rate; pricing_performance: Band[]; by_source: { open_marketplace: { proposals: number; success: Rate }; invitations: { proposals: number; success: Rate } } };
  earnings: { released_by_month: Record<string, Series> };
  contracts: { count: number; average_value_minor: number | null; average_value_small_sample: boolean; repeat_client_rate: Rate; pipeline_minor: number; active: number };
  delivery: { revision_rate: Rate };
  external: { available: boolean; by_source: Array<{ source: string; found: number; applied: number; won: number }> };
  definitions: Record<string, string>;
};
type Client = {
  projects: { by_status: Record<string, number>; published: number };
  hiring: { proposals_per_project: number | null; time_to_first_proposal_hours: number | null; time_to_first_proposal_sample: number; time_to_hire_days: number | null; time_to_hire_sample: number; hiring_conversion: Rate };
  spend: { by_month: Record<string, Series>; by_category: Array<{ category_slug: string; by_mode: Record<string, number> }> };
  delivery: { active_contracts: number; completed_contracts: number; delivery_days: number | null; delivery_sample: number; revision_rate: Rate; repeat_hire_rate: Rate; committed_not_released_minor: number };
  definitions: Record<string, string>;
};
type Platform = {
  acquisition: { registrations_by_week: Series };
  activation: { active_freelancers_30d: number; active_clients_30d: number };
  marketplace: { native_listings_published: number; native_listings_published_30d: number; external_opportunities_30d: number | null; project_to_hire: Rate; categories: Array<{ category_slug: string; published: number; proposals: number; contracts: number }> };
  delivery: { completed_contracts_by_month: Series; dispute_rate: Rate };
  finance: { collected_by_mode: Record<string, number>; platform_revenue_by_mode: Record<string, number>; refunded_by_mode: Record<string, number>; ai_cost_30d_usd: number; ai_cost_per_completed_contract_usd: number | null; completed_contracts_30d: number };
  retention: { retention_30d: Rate };
  definitions: Record<string, string>;
};
type Org = { id: string; name: string };
type View = 'freelancer' | 'client' | 'platform';

function Stat({ label, value, note, title }: { label: string; value: ReactNode; note?: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <div className="v">{value}</div>
      <div className="l">{label}</div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}

function RateStat({ label, rate, definition }: { label: string; rate: Rate; definition?: string }) {
  return <Stat label={label} value={formatRate(rate)} note={sampleNote(rate)} title={definition} />;
}

function ByMode({ values, empty }: { values: Record<string, number>; empty: string }) {
  const modes = Object.keys(values);
  if (!modes.length) return <span className="muted">{empty}</span>;
  return <>{modes.map((m) => <div key={m}>{rupees(values[m])} <span className="muted small">{modeLabel(m)}</span></div>)}</>;
}

function MoneyCharts({ title, byMode }: { title: string; byMode: Record<string, Series> }) {
  const modes = Object.keys(byMode);
  if (!modes.length) return <p className="muted">{title}: nothing recorded in the last six months.</p>;
  return <>{modes.map((m) => <BarChart key={m} title={`${title} — ${modeLabel(m)}`} points={byMode[m].map((p) => ({ period: p.period, value: p.total }))} format={rupees} />)}</>;
}

function Definitions({ items }: { items: Record<string, string> }) {
  return (
    <details>
      <summary>How these numbers are defined</summary>
      <dl className="kv">{Object.entries(items).map(([k, v]) => <Fragment key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{v}</dd></Fragment>)}</dl>
    </details>
  );
}

function FreelancerView({ data }: { data: Freelancer }) {
  const d = data.definitions;
  return (
    <>
      <div className="stat-grid">
        <Stat label="Native proposals sent" value={data.proposals.total} title={d.proposals_sent} />
        <RateStat label="Proposal success rate" rate={data.proposals.success_rate} definition={d.proposal_success_rate} />
        <RateStat label="Shortlisted or better" rate={data.proposals.shortlist_rate} definition={d.shortlist_rate} />
        <Stat label="Average contract value" value={rupees(data.contracts.average_value_minor)} note={data.contracts.average_value_small_sample && data.contracts.count ? `Based on ${data.contracts.count} contract(s).` : ''} title={d.average_contract_value} />
        <RateStat label="Repeat clients" rate={data.contracts.repeat_client_rate} definition={d.repeat_client_rate} />
        <RateStat label="Deliveries sent back for revision" rate={data.delivery.revision_rate} definition={d.revision_rate} />
        <Stat label={`Agreed, not yet paid (${data.contracts.active} active)`} value={rupees(data.contracts.pipeline_minor)} note="Not guaranteed income." title={d.pipeline_value} />
      </div>
      <BarChart title="Proposals sent" points={data.proposals.by_month.map((p) => ({ period: p.period, value: p.sent }))} format={(v) => String(v)} />
      <BarChart title="Proposals that led to an offer" points={data.proposals.by_month.map((p) => ({ period: p.period, value: p.won }))} format={(v) => String(v)} />
      <MoneyCharts title="Earnings released to you" byMode={data.earnings.released_by_month} />

      <h3>Pricing performance</h3>
      <p className="muted small">{d.pricing_performance}</p>
      <table>
        <thead><tr><th scope="col">Your price vs the client budget</th><th scope="col">Proposals</th><th scope="col">Success rate</th></tr></thead>
        <tbody>{data.proposals.pricing_performance.map((b) => <tr key={b.band}><td>{{ below: 'Below the range', within: 'Within the range', above: 'Above the range', no_budget: 'No budget stated' }[b.band] ?? b.band}</td><td>{b.proposals}</td><td>{formatRate(b.success)}{b.success.small_sample && b.success.value !== null ? ' · small sample' : ''}</td></tr>)}</tbody>
      </table>

      <h3>Where your work comes from</h3>
      <table>
        <thead><tr><th scope="col">Source</th><th scope="col">Proposals or jobs</th><th scope="col">Result</th></tr></thead>
        <tbody>
          <tr><td>Marketplace (open projects)</td><td>{data.proposals.by_source.open_marketplace.proposals}</td><td>{formatRate(data.proposals.by_source.open_marketplace.success)} success</td></tr>
          <tr><td>Client invitations</td><td>{data.proposals.by_source.invitations.proposals}</td><td>{formatRate(data.proposals.by_source.invitations.success)} success</td></tr>
          {data.external.by_source.map((s) => <tr key={s.source}><td>External · {s.source}</td><td>{s.found} found · {s.applied} applied</td><td>{s.won} won (recorded by you)</td></tr>)}
        </tbody>
      </table>
      {!data.external.available && <p className="muted small">External job sources are not connected in this deployment.</p>}
      <p className="muted small">{d.external_pipeline}</p>
      <Definitions items={d} />
    </>
  );
}

function ClientView({ data }: { data: Client }) {
  const d = data.definitions;
  const statuses = Object.entries(data.projects.by_status);
  return (
    <>
      <div className="stat-grid">
        <Stat label="Projects published" value={data.projects.published} title={d.projects} />
        <Stat label="Proposals per project" value={data.hiring.proposals_per_project ?? '—'} title={d.proposals_per_project} />
        <Stat label="Hours to first proposal (median)" value={data.hiring.time_to_first_proposal_hours ?? '—'} note={data.hiring.time_to_first_proposal_sample > 0 && data.hiring.time_to_first_proposal_sample < 5 ? `Small sample (${data.hiring.time_to_first_proposal_sample}).` : ''} title={d.time_to_first_proposal_hours} />
        <Stat label="Days to hire (median)" value={data.hiring.time_to_hire_days ?? '—'} note={data.hiring.time_to_hire_sample > 0 && data.hiring.time_to_hire_sample < 5 ? `Small sample (${data.hiring.time_to_hire_sample}).` : ''} title={d.time_to_hire_days} />
        <RateStat label="Projects that led to a hire" rate={data.hiring.hiring_conversion} definition={d.hiring_conversion} />
        <Stat label="Days to complete a contract (median)" value={data.delivery.delivery_days ?? '—'} note={data.delivery.delivery_sample > 0 && data.delivery.delivery_sample < 5 ? `Small sample (${data.delivery.delivery_sample}).` : ''} title={d.delivery_days} />
        <RateStat label="Deliveries sent back for revision" rate={data.delivery.revision_rate} definition={d.revision_rate} />
        <RateStat label="Freelancers hired again" rate={data.delivery.repeat_hire_rate} definition={d.repeat_hire_rate} />
        <Stat label={`Committed, not yet released (${data.delivery.active_contracts} active)`} value={rupees(data.delivery.committed_not_released_minor)} title={d.committed_not_released} />
      </div>
      {statuses.length > 0 && <p className="muted">Projects by status: {statuses.map(([s, v]) => `${s.replace('_', ' ')} ${v}`).join(' · ')}</p>}
      <MoneyCharts title="Spend funded" byMode={data.spend.by_month} />
      {data.spend.by_category.length > 0 && (
        <table>
          <thead><tr><th scope="col">Category</th><th scope="col">Spend funded (all time)</th></tr></thead>
          <tbody>{data.spend.by_category.map((c) => <tr key={c.category_slug}><td>{c.category_slug.replace(/_/g, ' ')}</td><td><ByMode values={c.by_mode} empty="—" /></td></tr>)}</tbody>
        </table>
      )}
      <Definitions items={d} />
    </>
  );
}

function PlatformView({ data }: { data: Platform }) {
  const d = data.definitions;
  return (
    <>
      <div className="stat-grid">
        <Stat label="Active freelancers (30 days)" value={data.activation.active_freelancers_30d} title={d.active_freelancers_30d} />
        <Stat label="Active client organisations (30 days)" value={data.activation.active_clients_30d} title={d.active_clients_30d} />
        <Stat label="Native projects published" value={data.marketplace.native_listings_published} note={`${data.marketplace.native_listings_published_30d} in the last 30 days`} title={d.native_listings_published} />
        <Stat label="External jobs collected (30 days)" value={data.marketplace.external_opportunities_30d ?? 'Not connected'} title={d.external_opportunities_30d} />
        <RateStat label="Project to hire" rate={data.marketplace.project_to_hire} definition={d.project_to_hire} />
        <RateStat label="Dispute rate" rate={data.delivery.dispute_rate} definition={d.dispute_rate} />
        <RateStat label="30-day retention" rate={data.retention.retention_30d} definition={d.retention_30d} />
        <Stat label="Collected" value={<ByMode values={data.finance.collected_by_mode} empty="Nothing collected" />} title={d.collected_value} />
        <Stat label="Platform fee revenue" value={<ByMode values={data.finance.platform_revenue_by_mode} empty="No fees yet" />} title={d.platform_revenue} />
        <Stat label="Refunded" value={<ByMode values={data.finance.refunded_by_mode} empty="No refunds" />} />
        <Stat label="AI cost (30 days)" value={`$${data.finance.ai_cost_30d_usd.toFixed(2)}`} note={data.finance.ai_cost_per_completed_contract_usd === null ? 'No contracts completed in 30 days.' : `$${data.finance.ai_cost_per_completed_contract_usd.toFixed(2)} per completed contract`} title={d.ai_cost_per_completed_contract} />
      </div>
      <BarChart title="Registrations per week" points={data.acquisition.registrations_by_week.map((p) => ({ period: p.period, value: p.total }))} format={(v) => String(v)} />
      <BarChart title="Contracts completed (north-star metric)" points={data.delivery.completed_contracts_by_month.map((p) => ({ period: p.period, value: p.total }))} format={(v) => String(v)} />
      <h3>Category health</h3>
      <table>
        <thead><tr><th scope="col">Category</th><th scope="col">Published</th><th scope="col">Proposals</th><th scope="col">Contracts</th></tr></thead>
        <tbody>{data.marketplace.categories.map((c) => <tr key={c.category_slug}><td>{c.category_slug.replace(/_/g, ' ')}</td><td>{c.published}</td><td>{c.proposals}</td><td>{c.contracts}</td></tr>)}</tbody>
      </table>
      <Definitions items={d} />
    </>
  );
}

export default function AnalyticsPage() {
  const [token] = useSessionToken();
  const mode = useMode();
  const [view, setView] = useState<View>('freelancer');
  // Follow the Freelancer / Client switch (staff can still open the platform view).
  // One side at a time: the active side's numbers only. Platform numbers live in the Admin workspace (?view=platform).
  useEffect(() => {
    const platform = new URLSearchParams(window.location.search).get('view') === 'platform';
    setView(platform ? 'platform' : mode);
  }, [mode]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState('');
  const [staff, setStaff] = useState(false);
  const [freelancer, setFreelancer] = useState<Freelancer | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    api<{ roles: string[]; organizations: Org[] }>('/api/v1/me/identity')
      .then((i) => {
        const list = Array.isArray(i?.organizations) ? i.organizations : [];
        setOrgs(list);
        if (list[0]) setOrgId(list[0].id);
        const roles = Array.isArray(i?.roles) ? i.roles : [];
        setStaff(roles.includes('admin') || roles.includes('finance'));
      })
      .catch(() => setOrgs([]));
  }, [token]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (view === 'freelancer') { const f = await api<Freelancer>('/api/v1/analytics/freelancer'); setFreelancer(f && f.proposals && f.contracts ? f : null); }
      if (view === 'client' && orgId) { const c = await api<Client>(`/api/v1/analytics/client?organization_id=${encodeURIComponent(orgId)}`); setClient(c && c.hiring && c.delivery ? c : null); }
      if (view === 'platform') { const p = await api<Platform>('/api/v1/admin/analytics'); setPlatform(p && p.marketplace && p.finance ? p : null); }
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'You do not have access to these numbers.' : e instanceof Error ? e.message : 'Could not load analytics.');
    } finally {
      setLoading(false);
    }
  }, [view, orgId]);

  useEffect(() => { if (token) void load(); }, [token, load]);

  if (!token) return <main className="shell"><div className="card"><h2>Analytics</h2><p className="muted">Sign in first to see your numbers.</p><a className="btn" href="/">Go to sign in</a></div></main>;

  const TITLES: Record<View, string> = { freelancer: 'My freelance business', client: 'Hiring and spend', platform: 'Marketplace operations' };

  return (
    <main className="shell">
      <div className="row between"><h2>Analytics</h2><a className="link" href="/analytics/planning">Planning tools</a></div>
      <p className="muted">Computed from your records on this platform. Small samples are marked; test-mode payments are labelled and never added to real money.</p>
      <h3>{TITLES[view]}</h3>
      {view === 'client' && orgs.length === 0 && <p className="empty">Create a client account on the Account page to see hiring numbers.</p>}
      {view === 'platform' && !staff && <p className="empty">Marketplace numbers are for staff.</p>}
      {view === 'client' && orgs.length > 1 && (
        <div className="field"><label htmlFor="an-org">Client account</label><select id="an-org" value={orgId} onChange={(e) => setOrgId(e.target.value)}>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      <section aria-label={TITLES[view]}>
        {view === 'freelancer' && freelancer && <FreelancerView data={freelancer} />}
        {view === 'client' && client && <ClientView data={client} />}
        {view === 'platform' && platform && <PlatformView data={platform} />}
      </section>
      {view === 'client' && orgId && <SpendForecast organizationId={orgId} />}
      {view === 'platform' && staff && <BalanceAlertsPanel />}
    </main>
  );
}
