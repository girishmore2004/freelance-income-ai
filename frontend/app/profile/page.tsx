'use client';
import { ProfileReview } from './profile-review';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, useSessionToken } from '@/lib/api-client';
import { applyPicks, defaultPicks, scoreLabel, splitList, type Picks, type ProfileForm, type ResumeProject, type ResumeSuggestions } from '@/lib/profile-import';

/**
 * Freelancer profile (U17, spec §5 "Profile"): its own page in the sidebar.
 *
 * 1. Import from a resume (PDF, Word, text or pasted text). The F3 Profile
 *    Coach suggests a headline, summary, skills, services, projects and links;
 *    anything not in the resume is dropped by the server. Every item is a
 *    tick box, and ticking only fills the form — nothing is saved until the
 *    person presses Save. The resume file is not stored.
 * 2. Every field can be entered by hand.
 * 3. Projects you have done (title, what you did, skills, link, year).
 * 4. Projects for you: open projects scored against the saved profile.
 */

type Profile = {
  full_name: string; headline: string; bio: string; skills: string[]; services: string[]; portfolio_links: string[]; minimum_budget: number;
  currency: string; weekly_hours: number; hourly_rate: number; timezone: string; preferred_work_types: string[]; preferred_industries: string[]; dealbreakers: string[];
};
type Extract = { mode: 'model' | 'rules'; source: string; suggestions: ResumeSuggestions; dropped: string[]; note: string };
type Suggested = {
  native: Array<{ id: string; title: string; client_name: string; score: number; reasons: string[]; missing_skills: string[] }>;
  external: Array<{ id: string; title: string; source: string; score: number; reasons: string[] }>;
  note: string;
};

const EMPTY_PROJECT: ResumeProject = { title: '', description: '', skills: [], link: '', year: '' };
const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export default function ProfilePage() {
  const [token] = useSessionToken();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState<ProfileForm>({ headline: '', bio: '', skills: '', services: '', links: '' });
  const [name, setName] = useState('');
  const [hourlyRate, setHourlyRate] = useState('0');
  const [minimumBudget, setMinimumBudget] = useState('5000');
  const [weeklyHours, setWeeklyHours] = useState('10');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [workTypes, setWorkTypes] = useState('fixed, hourly');
  const [industries, setIndustries] = useState('');
  const [dealbreakers, setDealbreakers] = useState('');

  const [projects, setProjects] = useState<ResumeProject[]>([]);
  const [projectsAvailable, setProjectsAvailable] = useState(true);
  const [projectsDirty, setProjectsDirty] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState('');
  const [extract, setExtract] = useState<Extract | null>(null);
  const [picks, setPicks] = useState<Picks | null>(null);
  const [reading, setReading] = useState(false);
  const [importError, setImportError] = useState('');

  const [suggested, setSuggested] = useState<Suggested | null>(null);

  const loadSuggested = useCallback(async () => {
    try {
      const r = await api<Suggested>('/api/v1/me/suggested-projects');
      // Only a reply of the expected shape is shown; anything else must not take the page down.
      setSuggested(r && Array.isArray(r.native) && Array.isArray(r.external) ? r : null);
    } catch {
      setSuggested(null);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const [p, items] = await Promise.all([api<Profile>('/api/v1/profile'), api<{ available: boolean; items: ResumeProject[] }>('/api/v1/me/portfolio-projects').catch(() => ({ available: false, items: [] }))]);
      setName(p.full_name || '');
      setForm({ headline: p.headline || '', bio: p.bio || '', skills: (p.skills || []).join(', '), services: (p.services || []).join(', '), links: (p.portfolio_links || []).join('\n') });
      setHourlyRate(String(p.hourly_rate ?? 0));
      setMinimumBudget(String(p.minimum_budget ?? 5000));
      setWeeklyHours(String(p.weekly_hours ?? 10));
      setTimezone(p.timezone || 'Asia/Kolkata');
      setWorkTypes((p.preferred_work_types || []).join(', '));
      setIndustries((p.preferred_industries || []).join(', '));
      setDealbreakers((p.dealbreakers || []).join(', '));
      setProjects(Array.isArray(items.items) ? items.items : []);
      setProjectsAvailable(items.available !== false);
      setError('');
    } catch (e) {
      setError(message(e, 'Could not load your profile.'));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    void load();
    void loadSuggested();
  }, [token, load, loadSuggested]);

  async function readResume(e: FormEvent) {
    e.preventDefault();
    setImportError('');
    setNotice('');
    if (!file && pasted.trim().length < 40) {
      setImportError('Choose a resume file or paste at least a few lines of it.');
      return;
    }
    setReading(true);
    try {
      let r: Extract;
      if (file) {
        const fd = new FormData();
        fd.set('file', file);
        r = await api<Extract>('/api/v1/profile/resume-extract', 'POST', fd);
      } else {
        r = await api<Extract>('/api/v1/profile/resume-extract', 'POST', { text: pasted });
      }
      setExtract(r);
      setPicks(defaultPicks(r.suggestions));
    } catch (err) {
      setImportError(message(err, 'Could not read that resume.'));
    } finally {
      setReading(false);
    }
  }

  function toggle<K extends 'skills' | 'services' | 'links'>(key: K, value: string) {
    setPicks((p) => (p ? { ...p, [key]: p[key].includes(value) ? p[key].filter((v) => v !== value) : [...p[key], value] } : p));
  }

  function addPicked() {
    if (!extract || !picks) return;
    const r = applyPicks(form, projects, extract.suggestions, picks);
    setForm(r.form);
    if (r.projects.length !== projects.length) setProjectsDirty(true);
    setProjects(r.projects);
    setExtract(null);
    setPicks(null);
    setFile(null);
    setPasted('');
    setNotice(r.added ? `Added ${r.added} item${r.added === 1 ? '' : 's'} to the form below. Check them, then press Save profile${r.projects.length ? ' and Save projects' : ''}.` : 'Nothing new to add: your profile already has these.');
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/api/v1/profile', 'PUT', {
        full_name: name, headline: form.headline, bio: form.bio, skills: splitList(form.skills, /,/), services: splitList(form.services, /,/),
        portfolio_links: splitList(form.links, /\n/), minimum_budget: Number(minimumBudget), currency: 'INR', weekly_hours: Number(weeklyHours),
        hourly_rate: Number(hourlyRate), timezone, preferred_work_types: splitList(workTypes, /,/), preferred_industries: splitList(industries, /,/), dealbreakers: splitList(dealbreakers, /,/),
      });
      if (projectsDirty && projectsAvailable) await saveProjectsNow();
      setNotice('Profile saved.');
      void loadSuggested();
    } catch (err) {
      setError(message(err, 'Could not save your profile.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveProjectsNow() {
    const r = await api<{ items: ResumeProject[] }>('/api/v1/me/portfolio-projects', 'PUT', { items: projects });
    setProjects(r.items);
    setProjectsDirty(false);
  }

  async function saveProjects() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await saveProjectsNow();
      setNotice('Projects saved.');
      void loadSuggested();
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'MIGRATION_PENDING' ? 'Projects are not available yet (a database update is pending).' : message(err, 'Could not save your projects.'));
    } finally {
      setBusy(false);
    }
  }

  function editProject(i: number, patch: Partial<ResumeProject>) {
    setProjects((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
    setProjectsDirty(true);
  }

  if (!token) return <main className="shell"><div className="card"><h2>Profile</h2><p className="muted">Sign in first to edit your profile.</p><a className="btn" href="/">Go to sign in</a></div></main>;

  const s = extract?.suggestions;
  return (
    <main className="shell">
      <h2>Your profile</h2>
      <p className="muted">Clients and the matching engine read this. Import it from your resume or fill it in yourself — only true facts.</p>
      {notice && <p className="success" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <section className="card" aria-label="Import from resume">
        <h3>Import from your resume</h3>
        <p className="muted">PDF, Word (.docx) or text, up to 5 MB — or paste the text. The AI suggests what to add; you tick what is right. The file is read once and not stored. Skills and projects that are not in the resume are dropped.</p>
        <form onSubmit={readResume}>
          <div className="field">
            <label htmlFor="resume-file">Resume file</label>
            <input id="resume-file" type="file" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="field">
            <label htmlFor="resume-text">Or paste your resume</label>
            <textarea id="resume-text" rows={5} maxLength={30000} value={pasted} onChange={(e) => setPasted(e.target.value)} disabled={!!file} />
          </div>
          <button className="btn primary" type="submit" disabled={reading}>{reading ? 'Reading…' : 'Read resume'}</button>
        </form>
        {importError && <p className="error" role="alert">{importError}</p>}

        {s && picks && (
          <div aria-label="Resume suggestions" role="group">
            <h4>Suggestions {extract.mode === 'rules' && <span className="badge">rules only</span>}</h4>
            {extract.note && <p className="muted">{extract.note}</p>}
            {s.headline && <label className="row"><input type="checkbox" checked={picks.headline} onChange={() => setPicks({ ...picks, headline: !picks.headline })} /> Headline: <b>{s.headline}</b></label>}
            {s.summary && <label className="row"><input type="checkbox" checked={picks.summary} onChange={() => setPicks({ ...picks, summary: !picks.summary })} /> Summary for your bio: {s.summary}</label>}
            {s.skills.length > 0 && (
              <fieldset><legend>Skills</legend>
                {s.skills.map((k) => <label key={k} className="chip"><input type="checkbox" checked={picks.skills.includes(k)} onChange={() => toggle('skills', k)} /> {k}</label>)}
              </fieldset>
            )}
            {s.services.length > 0 && (
              <fieldset><legend>Services</legend>
                {s.services.map((k) => <label key={k} className="chip"><input type="checkbox" checked={picks.services.includes(k)} onChange={() => toggle('services', k)} /> {k}</label>)}
              </fieldset>
            )}
            {s.projects.length > 0 && (
              <fieldset><legend>Projects</legend>
                {s.projects.map((p, i) => (
                  <label key={`${p.title}-${i}`} className="row">
                    <input type="checkbox" checked={picks.projects.includes(i)} onChange={() => setPicks({ ...picks, projects: picks.projects.includes(i) ? picks.projects.filter((x) => x !== i) : [...picks.projects, i] })} />
                    <span><b>{p.title}</b>{p.year && ` (${p.year})`}{p.description && ` — ${p.description}`}{p.skills.length > 0 && <span className="muted"> · {p.skills.join(', ')}</span>}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {s.links.length > 0 && (
              <fieldset><legend>Links</legend>
                {s.links.map((k) => <label key={k} className="row"><input type="checkbox" checked={picks.links.includes(k)} onChange={() => toggle('links', k)} /> {k}</label>)}
              </fieldset>
            )}
            {extract.dropped.length > 0 && (
              <details><summary>{extract.dropped.length} suggestion(s) removed because the resume does not support them</summary><ul>{extract.dropped.map((d) => <li key={d}>{d}</li>)}</ul></details>
            )}
            {!s.headline && !s.summary && !s.skills.length && !s.services.length && !s.projects.length && !s.links.length
              ? <p className="empty">Nothing could be read from that resume. Fill in the form below instead.</p>
              : <div className="row"><button className="btn primary" type="button" onClick={addPicked}>Add ticked items to the form</button><button className="btn" type="button" onClick={() => { setExtract(null); setPicks(null); }}>Discard</button></div>}
          </div>
        )}
      </section>

      {!loaded ? <p className="muted">Loading your profile…</p> : (
        <form className="card" aria-label="Profile details" onSubmit={saveProfile}>
          <h3>Profile details</h3>
          <div className="field"><label htmlFor="pf-name">Full name</label><input id="pf-name" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><label htmlFor="pf-headline">Headline (your role in one line)</label><input id="pf-headline" value={form.headline} maxLength={240} onChange={(e) => setForm({ ...form, headline: e.target.value })} /></div>
          <div className="field"><label htmlFor="pf-bio">Bio and experience (true facts only)</label><textarea id="pf-bio" rows={5} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></div>
          <div className="field"><label htmlFor="pf-skills">Skills (comma separated)</label><input id="pf-skills" value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} /></div>
          <div className="field"><label htmlFor="pf-services">Services you offer (comma separated)</label><input id="pf-services" value={form.services} onChange={(e) => setForm({ ...form, services: e.target.value })} /></div>
          <div className="field"><label htmlFor="pf-links">Portfolio links (one per line, https://…). Proposals can cite only these.</label><textarea id="pf-links" rows={3} value={form.links} onChange={(e) => setForm({ ...form, links: e.target.value })} /></div>
          <div className="grid g3">
            <div className="field"><label htmlFor="pf-rate">Hourly rate (INR)</label><input id="pf-rate" type="number" min="0" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} /></div>
            <div className="field"><label htmlFor="pf-min">Minimum project budget (INR)</label><input id="pf-min" type="number" min="0" value={minimumBudget} onChange={(e) => setMinimumBudget(e.target.value)} /></div>
            <div className="field"><label htmlFor="pf-hours">Hours a week</label><input id="pf-hours" type="number" min="1" max="80" value={weeklyHours} onChange={(e) => setWeeklyHours(e.target.value)} /></div>
          </div>
          <div className="field"><label htmlFor="pf-tz">Time zone</label><input id="pf-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} /></div>
          <div className="field"><label htmlFor="pf-types">Work types: fixed, hourly (add full_time or internship to include those)</label><input id="pf-types" value={workTypes} onChange={(e) => setWorkTypes(e.target.value)} /></div>
          <div className="field"><label htmlFor="pf-ind">Preferred industries</label><input id="pf-ind" value={industries} onChange={(e) => setIndustries(e.target.value)} /></div>
          <div className="field"><label htmlFor="pf-deal">Dealbreakers (comma separated)</label><input id="pf-deal" value={dealbreakers} onChange={(e) => setDealbreakers(e.target.value)} /></div>
          <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
          <p className="muted">These guide matching and price estimates. They do not guarantee work or commit you to a price.</p>
        </form>
      )}

      <section className="card" aria-label="Your projects">
        <h3>Projects you have done</h3>
        {!projectsAvailable ? <p className="muted">Projects become available after the next database update.</p> : (
          <>
            <p className="muted">Up to 20. Clients see these on your profile, and their skills count in matching.</p>
            {projects.length === 0 && <p className="empty">No projects yet. Import them from your resume or add one.</p>}
            {projects.map((p, i) => (
              <fieldset key={i} className="card item">
                <legend>Project {i + 1}</legend>
                <div className="field"><label htmlFor={`pj-title-${i}`}>Title</label><input id={`pj-title-${i}`} value={p.title} maxLength={120} onChange={(e) => editProject(i, { title: e.target.value })} /></div>
                <div className="field"><label htmlFor={`pj-desc-${i}`}>What you did</label><textarea id={`pj-desc-${i}`} rows={2} maxLength={1000} value={p.description} onChange={(e) => editProject(i, { description: e.target.value })} /></div>
                <div className="grid g3">
                  <div className="field"><label htmlFor={`pj-skills-${i}`}>Skills used</label><input id={`pj-skills-${i}`} value={p.skills.join(', ')} onChange={(e) => editProject(i, { skills: splitList(e.target.value, /,/).slice(0, 10) })} /></div>
                  <div className="field"><label htmlFor={`pj-link-${i}`}>Link (optional)</label><input id={`pj-link-${i}`} type="url" value={p.link} placeholder="https://" onChange={(e) => editProject(i, { link: e.target.value })} /></div>
                  <div className="field"><label htmlFor={`pj-year-${i}`}>Year</label><input id={`pj-year-${i}`} inputMode="numeric" maxLength={4} value={p.year} onChange={(e) => editProject(i, { year: e.target.value })} /></div>
                </div>
                <button className="link" type="button" onClick={() => { setProjects(projects.filter((_, j) => j !== i)); setProjectsDirty(true); }}>Remove project {i + 1}</button>
              </fieldset>
            ))}
            <div className="row">
              <button className="btn" type="button" disabled={projects.length >= 20} onClick={() => { setProjects([...projects, { ...EMPTY_PROJECT }]); setProjectsDirty(true); }}>Add a project</button>
              <button className="btn primary" type="button" disabled={busy || !projectsDirty} onClick={() => void saveProjects()}>Save projects</button>
            </div>
          </>
        )}
      </section>

      <ProfileReview />

      <section className="card" aria-label="Projects for you">
        <div className="row between"><h3>Projects for you</h3><button className="btn" type="button" onClick={() => void loadSuggested()}>Refresh</button></div>
        <p className="muted">Scored against your saved profile: skills, budget, services and availability. Save your profile to update.</p>
        {!suggested ? <p className="muted">Loading…</p> : (
          <>
            {suggested.note && <p className="empty">{suggested.note}</p>}
            {suggested.native.length > 0 && <h4>On this marketplace</h4>}
            <ul>
              {suggested.native.map((p) => (
                <li key={p.id} className="card item">
                  <div className="row between"><b>{p.title}</b><span className="badge">{p.score}/100 · {scoreLabel(p.score)}</span></div>
                  <p className="muted">{p.client_name}</p>
                  <ul className="muted">{p.reasons.slice(0, 4).map((r) => <li key={r}>{r}</li>)}</ul>
                  {p.missing_skills.length > 0 && <p className="muted">Skills they asked for that your profile lacks: {p.missing_skills.join(', ')}</p>}
                  <a className="btn" href={`/projects?project=${encodeURIComponent(p.id)}`}>Open project</a>
                </li>
              ))}
            </ul>
            {suggested.external.length > 0 && <h4>From job sites</h4>}
            <ul>
              {suggested.external.map((o) => (
                <li key={o.id} className="card item">
                  <div className="row between"><b>{o.title}</b><span className="badge">{o.score}/100 · {scoreLabel(o.score)}</span></div>
                  <p className="muted">Source: {o.source}{o.reasons[0] ? ` · ${o.reasons[0]}` : ''}</p>
                  <a className="link" href="/projects?view=external">Open in Find work</a>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
