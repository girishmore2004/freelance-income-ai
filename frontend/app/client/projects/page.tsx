'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { NotificationLink } from '../../notification-link';
import { ApiError, api, useSessionToken } from '@/lib/api-client';
import { STATUS_LABELS, formatBudget, linesToList, minorToRupees, rupeesToMinor } from '@/lib/listing-format';
import { MatchPanel, SavedFreelancers } from './match-panel';
import { ProposalsPanel } from './proposals-panel';

/**
 * Client project posting (Phase 2). The client describes the work, can ask the
 * AI Brief Builder for a draft, edits every field, sets budget and deadline
 * themselves, then saves a draft or submits. All data comes from the Edge API.
 */

type Org = { id: string; name: string; membership_role: string };
type Category = { slug: string; name: string; description: string; template: { stages: string[]; acceptance: string[]; default_revisions: number } };
type Milestone = { title: string; description: string };
type Brief = {
  title: string; category_slug: string; outcome: string; description: string; deliverables: string[]; skills: string[];
  experience_level: string; budget_model: string; budget_min_minor: number | null; budget_max_minor: number | null; currency: string;
  deadline: string | null; milestones: Milestone[]; acceptance_criteria: string[]; revision_rounds: number; languages: string[];
  timezone: string; confidentiality: string; ownership_notes: string; assumptions: string[];
};
type Listing = { id: string; status: string; visibility: string; moderation_status: string; current_version: number; published_at: string | null; closes_at: string | null; brief: Brief };
type Draft = { title: string; outcome: string; deliverables: string[]; skills: string[]; milestones: Milestone[]; acceptance_criteria: string[]; assumptions: string[]; questions: string[]; conflicts: string[]; revision_rounds: number };
type Assist = { draft: Draft; source: 'model' | 'template'; note?: string; message?: string };

type Form = {
  category_slug: string; title: string; outcome: string; description: string; deliverables: string; skills: string;
  experience_level: string; budget_model: string; budget_min: string; budget_max: string; deadline: string;
  milestones: string; acceptance: string; revision_rounds: string; confidentiality: string; visibility: string;
  ownership_notes: string; assumptions: string; closes_at: string;
};

const EMPTY: Form = {
  category_slug: '', title: '', outcome: '', description: '', deliverables: '', skills: '', experience_level: 'any',
  budget_model: 'fixed', budget_min: '', budget_max: '', deadline: '', milestones: '', acceptance: '', revision_rounds: '2',
  confidentiality: 'standard', visibility: 'public', ownership_notes: '', assumptions: '', closes_at: '',
};

const ACTIONS: Record<string, { action: string; label: string }[]> = {
  draft: [{ action: 'submit', label: 'Submit for publishing' }, { action: 'cancel', label: 'Cancel' }],
  in_review: [{ action: 'cancel', label: 'Cancel' }],
  published: [{ action: 'pause', label: 'Pause' }, { action: 'close', label: 'Close' }, { action: 'cancel', label: 'Cancel' }],
  paused: [{ action: 'resume', label: 'Resume' }, { action: 'close', label: 'Close' }, { action: 'cancel', label: 'Cancel' }],
  hiring: [{ action: 'close', label: 'Close' }],
};

function formFromBrief(brief: Brief, visibility: string, closesAt: string | null): Form {
  return {
    category_slug: brief.category_slug, title: brief.title, outcome: brief.outcome, description: brief.description,
    deliverables: brief.deliverables.join('\n'), skills: brief.skills.join(', '), experience_level: brief.experience_level,
    budget_model: brief.budget_model, budget_min: minorToRupees(brief.budget_min_minor), budget_max: minorToRupees(brief.budget_max_minor),
    deadline: brief.deadline ?? '', milestones: brief.milestones.map((m) => m.title).join('\n'), acceptance: brief.acceptance_criteria.join('\n'),
    revision_rounds: String(brief.revision_rounds), confidentiality: brief.confidentiality, visibility,
    ownership_notes: brief.ownership_notes, assumptions: brief.assumptions.join('\n'), closes_at: closesAt ? closesAt.slice(0, 10) : '',
  };
}

function payloadFrom(form: Form): { payload?: Record<string, unknown>; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const min = rupeesToMinor(form.budget_min);
  const max = rupeesToMinor(form.budget_max);
  if (Number.isNaN(min)) errors.budget_min_minor = 'Enter an amount in rupees, for example 25000.';
  if (Number.isNaN(max)) errors.budget_max_minor = 'Enter an amount in rupees, for example 50000.';
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    payload: {
      category_slug: form.category_slug, title: form.title, outcome: form.outcome, description: form.description,
      deliverables: linesToList(form.deliverables), skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
      experience_level: form.experience_level, budget_model: form.budget_model, budget_min_minor: min, budget_max_minor: max,
      currency: 'INR', deadline: form.deadline || null, milestones: linesToList(form.milestones).map((title) => ({ title, description: '' })),
      acceptance_criteria: linesToList(form.acceptance), revision_rounds: Number(form.revision_rounds),
      confidentiality: form.confidentiality, visibility: form.visibility, ownership_notes: form.ownership_notes,
      assumptions: linesToList(form.assumptions), languages: ['en'], closes_at: form.closes_at || null,
    },
  };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}

export default function ClientProjectsPage() {
  const [token] = useSessionToken();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [closed, setClosed] = useState('');
  const [editing, setEditing] = useState<{ id: string | null; baseVersion: number } | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [assist, setAssist] = useState<Assist | null>(null);
  const [matchesFor, setMatchesFor] = useState<string | null>(null);
  const [proposalsFor, setProposalsFor] = useState<string | null>(null);

  const loadListings = useCallback(async (organizationId: string) => {
    if (!organizationId) return;
    setListings(await api<Listing[]>(`/api/v1/organizations/${organizationId}/listings`));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const identity = await api<{ roles: string[]; organizations: Org[]; client_side_enabled: boolean }>('/api/v1/me/identity');
      if (!identity.client_side_enabled) { setClosed('Posting projects opens when the client marketplace launches.'); return; }
      if (!identity.roles.includes('client')) { setClosed('Turn on the "Hire freelancers" role on the Account page first.'); return; }
      if (!identity.organizations.length) { setClosed('Create a client account on the Account page first.'); return; }
      setClosed('');
      setOrgs(identity.organizations);
      const selected = orgId || identity.organizations[0].id;
      setOrgId(selected);
      setCategories(await api<Category[]>('/api/v1/project-categories'));
      await loadListings(selected);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }, [orgId, loadListings]);

  useEffect(() => {
    if (token) void load();
    // load() reads orgId; re-running on every org change is handled by changeOrg.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function changeOrg(id: string) {
    setOrgId(id);
    setEditing(null);
    try { await loadListings(id); } catch (e) { setError(messageOf(e)); }
  }

  function startNew() {
    setEditing({ id: null, baseVersion: 0 });
    setForm({ ...EMPTY, category_slug: categories[0]?.slug ?? '' });
    setAssist(null);
    setNotes('');
    setFieldErrors({});
    setNotice('');
    setError('');
  }

  function startEdit(listing: Listing) {
    setEditing({ id: listing.id, baseVersion: listing.current_version });
    setForm(formFromBrief(listing.brief, listing.visibility, listing.closes_at));
    setAssist(null);
    setFieldErrors({});
    setNotice('');
    setError('');
  }

  async function askAssistant() {
    setBusy(true);
    setError('');
    try {
      const result = await api<Assist>(`/api/v1/organizations/${orgId}/brief-assistant`, 'POST', { category_slug: form.category_slug, notes });
      setAssist(result);
      const d = result.draft;
      setForm((f) => ({
        ...f,
        title: d.title, outcome: d.outcome, deliverables: d.deliverables.join('\n'), skills: d.skills.join(', '),
        milestones: d.milestones.map((m) => m.title).join('\n'), acceptance: d.acceptance_criteria.join('\n'),
        assumptions: d.assumptions.join('\n'), revision_rounds: String(d.revision_rounds),
        description: f.description || notes,
      }));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function save(submitAfter: boolean, event?: FormEvent) {
    event?.preventDefault();
    if (!editing) return;
    const { payload, errors } = payloadFrom(form);
    setFieldErrors(errors);
    if (!payload) { setError('Check the highlighted fields.'); return; }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = editing.id
        ? await api<Listing & { message?: string }>(`/api/v1/listings/${editing.id}`, 'PUT', { ...payload, base_version: editing.baseVersion })
        : await api<Listing & { message?: string }>(`/api/v1/organizations/${orgId}/listings`, 'POST', payload);
      let message = saved.message ?? 'Saved';
      if (submitAfter) {
        const submitted = await api<{ message?: string }>(`/api/v1/listings/${saved.id}/transition`, 'POST', { action: 'submit' });
        message = submitted.message ?? 'Submitted';
      }
      setNotice(message);
      setEditing(null);
      await loadListings(orgId);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INVALID_BRIEF') {
        const details = e.details[0];
        setFieldErrors(details && typeof details === 'object' ? (details as Record<string, string>) : {});
        setError('Check the highlighted fields.');
      } else if (e instanceof ApiError && e.code === 'INCOMPLETE_BRIEF') {
        const details = e.details[0] as { gaps?: string[] } | undefined;
        setError(`Saved as a draft, but not submitted: ${(details?.gaps ?? []).join(' ')}`);
        setEditing(null);
        await loadListings(orgId);
      } else {
        setError(messageOf(e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function transition(listing: Listing, action: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ message?: string }>(`/api/v1/listings/${listing.id}/transition`, 'POST', { action });
      setNotice(result.message ?? 'Updated');
      await loadListings(orgId);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INCOMPLETE_BRIEF') {
        const details = e.details[0] as { gaps?: string[] } | undefined;
        setError(`Complete the brief first: ${(details?.gaps ?? []).join(' ')}`);
      } else setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof Form) => (event: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const fieldError = (key: string, id: string) => fieldErrors[key] ? <p className="error" id={`${id}-error`}>{fieldErrors[key]}</p> : null;
  const invalid = (key: string, id: string) => ({ 'aria-invalid': Boolean(fieldErrors[key]), 'aria-describedby': fieldErrors[key] ? `${id}-error` : undefined });
  const role = orgs.find((o) => o.id === orgId)?.membership_role ?? 'member';
  const canManage = role === 'owner' || role === 'admin';

  if (!token) {
    return (
      <main className="shell"><div className="card"><h2>Client projects</h2><p className="muted">Sign in first, then open this page to post and manage projects.</p><a className="btn" href="/">Go to sign in</a></div></main>
    );
  }

  return (
    <main className="shell">
      <div className="row between">
        <h2>Client projects</h2>
        <span className="row"><NotificationLink /><a className="link" href="/contracts">Contracts</a><a className="link" href="/account">← Account &amp; roles</a></span>
      </div>
      <div aria-live="polite">
        {notice && <p className="success">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      {loading && <p className="muted">Loading…</p>}
      {closed && !loading && <div className="card"><p className="muted">{closed}</p><a className="btn" href="/account">Open Account &amp; roles</a></div>}

      {!closed && !loading && orgs.length > 0 && (
        <>
          <div className="row">
            <div className="field">
              <label htmlFor="org">Client account</label>
              <select id="org" value={orgId} onChange={(e) => void changeOrg(e.target.value)}>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            {!editing && <button className="btn primary" onClick={startNew} disabled={!categories.length}>Post a new project</button>}
          </div>
          {!categories.length && <p className="muted">No work categories are open yet.</p>}

          {editing && (
            <form className="card" onSubmit={(e) => void save(false, e)} noValidate aria-labelledby="brief-heading">
              <h3 id="brief-heading">{editing.id ? `Edit project (new version after v${editing.baseVersion})` : 'New project'}</h3>

              <div className="field">
                <label htmlFor="category">Work category</label>
                <select id="category" value={form.category_slug} onChange={set('category_slug')} {...invalid('category_slug', 'category')}>
                  {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                </select>
                {fieldError('category_slug', 'category')}
              </div>

              {!editing.id && (
                <div className="card">
                  <label htmlFor="notes"><b>Describe the project in your own words</b> (optional AI help)</label>
                  <textarea id="notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={6000} placeholder="What do you need, for whom, and what does done look like?" />
                  <button className="btn" type="button" disabled={busy || notes.trim().length < 20} onClick={() => void askAssistant()}>
                    {busy ? 'Working…' : 'Draft the brief with AI'}
                  </button>
                  <p className="muted">The AI suggests fields for you to check. It never sets budget or dates and never publishes.</p>
                  {assist && (
                    <div aria-live="polite">
                      <p className="muted">{assist.source === 'model' ? 'AI draft added below. Review every field.' : assist.note ?? 'Template draft added below.'}</p>
                      {assist.draft.questions.length > 0 && (<><b>Questions to answer in the brief</b><ul>{assist.draft.questions.map((q) => <li key={q}>{q}</li>)}</ul></>)}
                      {assist.draft.conflicts.length > 0 && (<><b>Possible conflicts</b><ul>{assist.draft.conflicts.map((c) => <li key={c}>{c}</li>)}</ul></>)}
                    </div>
                  )}
                </div>
              )}

              <div className="field"><label htmlFor="title">Project title (required)</label><input id="title" value={form.title} onChange={set('title')} maxLength={160} {...invalid('title', 'title')} />{fieldError('title', 'title')}</div>
              <div className="field"><label htmlFor="outcome">Business outcome</label><textarea id="outcome" rows={3} value={form.outcome} onChange={set('outcome')} maxLength={2000} {...invalid('outcome', 'outcome')} />{fieldError('outcome', 'outcome')}</div>
              <div className="field"><label htmlFor="description">Details</label><textarea id="description" rows={4} value={form.description} onChange={set('description')} maxLength={8000} {...invalid('description', 'description')} />{fieldError('description', 'description')}</div>
              <div className="field"><label htmlFor="deliverables">Deliverables (one per line)</label><textarea id="deliverables" rows={3} value={form.deliverables} onChange={set('deliverables')} {...invalid('deliverables', 'deliverables')} />{fieldError('deliverables', 'deliverables')}</div>
              <div className="field"><label htmlFor="skills">Skills (comma separated)</label><input id="skills" value={form.skills} onChange={set('skills')} {...invalid('skills', 'skills')} />{fieldError('skills', 'skills')}</div>
              <div className="field"><label htmlFor="experience">Experience level</label>
                <select id="experience" value={form.experience_level} onChange={set('experience_level')}><option value="any">Any</option><option value="entry">Entry</option><option value="intermediate">Intermediate</option><option value="expert">Expert</option></select></div>

              <div className="field"><label htmlFor="budget-model">Budget type</label>
                <select id="budget-model" value={form.budget_model} onChange={set('budget_model')}><option value="fixed">Fixed price</option><option value="hourly">Hourly</option></select></div>
              <div className="row">
                <div className="field"><label htmlFor="budget-min">Minimum budget (₹)</label><input id="budget-min" inputMode="decimal" value={form.budget_min} onChange={set('budget_min')} {...invalid('budget_min_minor', 'budget-min')} />{fieldError('budget_min_minor', 'budget-min')}</div>
                <div className="field"><label htmlFor="budget-max">Maximum budget (₹)</label><input id="budget-max" inputMode="decimal" value={form.budget_max} onChange={set('budget_max')} {...invalid('budget_max_minor', 'budget-max')} />{fieldError('budget_max_minor', 'budget-max')}</div>
              </div>
              <div className="row">
                <div className="field"><label htmlFor="deadline">Deadline</label><input id="deadline" type="date" value={form.deadline} onChange={set('deadline')} {...invalid('deadline', 'deadline')} />{fieldError('deadline', 'deadline')}</div>
                <div className="field"><label htmlFor="closes-at">Stop taking proposals after (optional, up to 180 days)</label><input id="closes-at" type="date" value={form.closes_at} onChange={set('closes_at')} {...invalid('closes_at', 'closes-at')} />{fieldError('closes_at', 'closes-at')}</div>
              </div>

              <div className="field"><label htmlFor="milestones">Milestones (one per line)</label><textarea id="milestones" rows={3} value={form.milestones} onChange={set('milestones')} {...invalid('milestones', 'milestones')} />{fieldError('milestones', 'milestones')}</div>
              <div className="field"><label htmlFor="acceptance">Acceptance criteria (one per line)</label><textarea id="acceptance" rows={3} value={form.acceptance} onChange={set('acceptance')} {...invalid('acceptance_criteria', 'acceptance')} />{fieldError('acceptance_criteria', 'acceptance')}</div>
              <div className="field"><label htmlFor="revisions">Included revision rounds</label><input id="revisions" type="number" min={0} max={10} value={form.revision_rounds} onChange={set('revision_rounds')} {...invalid('revision_rounds', 'revisions')} />{fieldError('revision_rounds', 'revisions')}</div>
              <div className="field"><label htmlFor="assumptions">Assumptions (one per line)</label><textarea id="assumptions" rows={2} value={form.assumptions} onChange={set('assumptions')} /></div>
              <div className="field"><label htmlFor="ownership">Ownership and licensing notes (private to your team)</label><textarea id="ownership" rows={2} value={form.ownership_notes} onChange={set('ownership_notes')} maxLength={2000} /></div>
              <div className="row">
                <div className="field"><label htmlFor="visibility">Visibility</label>
                  <select id="visibility" value={form.visibility} onChange={set('visibility')}><option value="public">Public</option><option value="invite_only">Invite only</option><option value="private">Private</option></select></div>
                <div className="field"><label htmlFor="confidentiality">Confidentiality</label>
                  <select id="confidentiality" value={form.confidentiality} onChange={set('confidentiality')}><option value="standard">Standard</option><option value="confidential">Confidential (hide our name and details)</option></select></div>
              </div>

              <div className="row">
                <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button>
                {canManage && (!editing.id || listings.find((l) => l.id === editing.id)?.status === 'draft') && (
                  <button className="btn primary" type="button" disabled={busy} onClick={() => void save(true)}>Save and submit</button>
                )}
                <button className="btn" type="button" onClick={() => setEditing(null)} disabled={busy}>Close</button>
              </div>
            </form>
          )}

          <section aria-labelledby="list-heading">
            <h3 id="list-heading">Your projects</h3>
            {listings.length === 0 && <p className="empty">No projects yet. Use “Post a new project” to start.</p>}
            {listings.map((l) => (
              <div className="card item" key={l.id}>
                <div className="row between"><b>{l.brief.title}</b><span className="badge">{STATUS_LABELS[l.status] ?? l.status} · v{l.current_version}</span></div>
                <p className="muted">{formatBudget(l.brief.budget_min_minor, l.brief.budget_max_minor, l.brief.currency, l.brief.budget_model)} · {l.brief.deadline ? `Deadline ${l.brief.deadline}` : 'No deadline'} · {l.visibility}{l.closes_at ? ` · Closes ${l.closes_at.slice(0, 10)}` : ''}</p>
                {l.status === 'in_review' && <p className="muted">Waiting for a moderator. Edit the brief to return it to draft.</p>}
                <div className="row">
                  {['draft', 'in_review', 'published', 'paused'].includes(l.status) && <button className="btn" disabled={busy} onClick={() => startEdit(l)}>Edit</button>}
                  {canManage && (ACTIONS[l.status] ?? []).map((a) => (
                    <button key={a.action} className={`btn${a.action === 'submit' ? ' primary' : ''}`} disabled={busy} onClick={() => void transition(l, a.action)}>{a.label}</button>
                  ))}
                  {['draft', 'in_review', 'published', 'hiring', 'paused'].includes(l.status) && (
                    <button className="btn" aria-expanded={matchesFor === l.id} onClick={() => setMatchesFor(matchesFor === l.id ? null : l.id)}>
                      {matchesFor === l.id ? 'Hide suggestions' : 'Find freelancers'}
                    </button>
                  )}
                  {['published', 'hiring', 'paused', 'closed', 'expired'].includes(l.status) && (
                    <button className="btn" aria-expanded={proposalsFor === l.id} onClick={() => setProposalsFor(proposalsFor === l.id ? null : l.id)}>
                      {proposalsFor === l.id ? 'Hide proposals' : 'Proposals'}
                    </button>
                  )}
                </div>
                {proposalsFor === l.id && <ProposalsPanel listingId={l.id} brief={l.brief} canManage={canManage && ['published', 'hiring', 'paused'].includes(l.status)} />}
                {matchesFor === l.id && (
                  <MatchPanel listingId={l.id} organizationId={orgId} canInvite={canManage}
                    invitable={['published', 'hiring'].includes(l.status) && l.visibility !== 'private'} />
                )}
              </div>
            ))}
          </section>
          <SavedFreelancers key={orgId} organizationId={orgId} />
        </>
      )}
    </main>
  );
}
