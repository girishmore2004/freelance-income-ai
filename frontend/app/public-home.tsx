'use client';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '@/lib/api-client';

/**
 * Public homepage for visitors (PRODUCT_EXPERIENCE_SPEC §2). Everything shown
 * comes from the API: categories with their real open/closed state, agents
 * that are actually live, and counts that appear only when they are above
 * zero. The sign-in card (passed in) stays on the page.
 */

type Home = {
  client_marketplace_open: boolean;
  categories: Array<{ slug: string; name: string; open: boolean }>;
  agents: Array<{ code: string; name: string; side: string; purpose: string; status: string }>;
  counts: { published_projects: number; visible_freelancers: number; completed_contracts: number } | null;
};

const SIDE: Record<string, string> = { freelancer: 'For freelancers', client: 'For clients', platform: 'Platform safety' };

export function PublicHome({ signIn }: { signIn: ReactNode }) {
  const [home, setHome] = useState<Home | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    api<Home>('/api/v1/public/home')
      .then((h) => { if (h && Array.isArray(h.categories)) setHome(h); })
      .catch(() => setHome(null));
  }, []);

  function search(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    window.location.href = q ? `/projects?q=${encodeURIComponent(q)}` : '/projects';
  }

  const counts = home?.counts;
  const stats = counts
    ? ([['published_projects', 'open projects'], ['visible_freelancers', 'freelancers available to hire'], ['completed_contracts', 'completed contracts']] as const).filter(([k]) => counts[k] > 0)
    : [];
  const agentsBySide = (home?.agents ?? []).reduce<Record<string, Home['agents']>>((acc, a) => {
    (acc[a.side] ??= []).push(a);
    return acc;
  }, {});

  return (
    <div className="pub">
      <a className="skip" href="#content">Skip to content</a>
      <header className="pub-nav">
        <div className="inner">
          <a href="/" className="row" style={{ gap: 10 }}><span className="logo" aria-hidden="true">F</span><b>Freelance Income AI</b></a>
          <nav className="links" aria-label="Main">
            <a href="/projects">Find work</a>
            <a href="/client/projects">Hire freelancers</a>
            <a href="#categories">Categories</a>
            <a href="/how-it-works">How it works</a>
            <a href="/pricing">Pricing</a>
          </nav>
          <div className="actions">
            <a className="btn" href="#signin">Log in</a>
            <a className="btn primary" href="#signin">Get started</a>
          </div>
        </div>
      </header>

      <main id="content">
        <div className="wrap hero">
          <div>
            <span className="eyebrow">AI-assisted freelance marketplace</span>
            <h1>Find freelance work. Hire the right talent. Let AI do the preparation.</h1>
            <p className="lead">
              Specialised AI agents find matching projects, draft proposals, compare candidates and check deliveries against what was agreed.
              You make every decision: nothing is sent, accepted or paid without your approval.
            </p>
            <div className="row">
              <a className="btn primary lg" href="/projects">Find freelance work</a>
              <a className="btn lg" href="/client/projects">Hire talent</a>
            </div>
            <form className="hero-search" role="search" onSubmit={search}>
              <label htmlFor="home-search" className="sr-only">Search projects and skills</label>
              <input id="home-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100} placeholder="Search projects, skills or services" />
              <button className="btn primary" type="submit">Search</button>
            </form>
            {stats.length > 0 && (
              <p className="muted" aria-label="Marketplace numbers">
                {stats.map(([k, label], i) => <span key={k}>{i > 0 ? ' · ' : ''}<b>{counts![k].toLocaleString('en-IN')}</b> {label}</span>)}
              </p>
            )}
          </div>
          <div className="card" id="signin" aria-label="Sign in">{signIn}</div>
        </div>

        <section className="section" id="categories" aria-labelledby="cat-heading">
          <div className="wrap">
            <h2 id="cat-heading">Categories</h2>
            <p className="sub">Each category has its own workflow template: stages, deliverables and acceptance checks fitted to the kind of work.</p>
            {home && home.categories.length > 0 ? (
              <div className="cat-grid">
                {home.categories.map((c) => (
                  <div className="cat" key={c.slug}>
                    <b>{c.name}</b>
                    <span className={`badge${c.open ? ' native' : ''}`}>{c.open ? 'Open for projects' : 'Opening soon'}</span>
                  </div>
                ))}
              </div>
            ) : <p className="muted">Categories load from the marketplace.</p>}
          </div>
        </section>

        <section className="section" aria-labelledby="how-heading">
          <div className="wrap">
            <h2 id="how-heading">How it works</h2>
            <p className="sub">One connected flow from the first search to the final review.</p>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
              <div>
                <h3>For freelancers</h3>
                <ol className="steps" style={{ gridTemplateColumns: '1fr', marginTop: 10 }}>
                  <li><b>Discover</b><p className="muted">Matching projects with the reasons they fit you, from this marketplace and approved public sources.</p></li>
                  <li><b>Propose</b><p className="muted">AI drafts from your confirmed profile. You edit and approve the exact text.</p></li>
                  <li><b>Deliver and get paid</b><p className="muted">Milestones, files, revisions and acceptance in one workspace; payment follows approval.</p></li>
                </ol>
              </div>
              <div>
                <h3>For clients</h3>
                <ol className="steps" style={{ gridTemplateColumns: '1fr', marginTop: 10 }}>
                  <li><b>Describe</b><p className="muted">Turn a rough idea into a structured brief with milestones and acceptance criteria.</p></li>
                  <li><b>Choose</b><p className="muted">Matched freelancers with explanations, and a side-by-side proposal comparison that never just picks the cheapest.</p></li>
                  <li><b>Review and approve</b><p className="muted">Check each delivery against what was agreed, request revisions, and approve to release payment.</p></li>
                </ol>
              </div>
            </div>
            <p><a className="link" href="/how-it-works">Read the full walkthrough</a></p>
          </div>
        </section>

        <section className="section" aria-labelledby="agents-heading">
          <div className="wrap">
            <h2 id="agents-heading">AI agents that prepare, not decide</h2>
            <p className="sub">Every agent has a defined job, works only with data you are allowed to see, and stops at a human decision. Agents never accept contracts, approve work, move money or suspend accounts.</p>
            {home && home.agents.length > 0 ? (
              <div className="agent-row">
                {Object.entries(agentsBySide).map(([side, list]) => (
                  <div className="card" key={side}>
                    <h3>{SIDE[side] ?? side}</h3>
                    <ul>{list.map((a) => <li key={a.code}><b>{a.name}</b>{a.status === 'partial' ? ' (partly built)' : ''} — <span className="muted">{a.purpose}</span></li>)}</ul>
                  </div>
                ))}
              </div>
            ) : <p className="muted">The agent catalogue loads from the platform.</p>}
          </div>
        </section>

        <section className="section" aria-labelledby="trust-heading">
          <div className="wrap grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}>
            <div className="card"><h3 id="trust-heading">Clear fees</h3><p className="muted">Fees are published on the pricing page once they are set. You see the exact amount before you commit.</p><a className="link" href="/pricing">Pricing and fees</a></div>
            <div className="card"><h3>Safety first</h3><p className="muted">Contact and payment details stay on the platform, listings are screened, and staff handle reports and disputes.</p><a className="link" href="/safety">Safety and trust</a></div>
            <div className="card"><h3>Payments</h3><p className="muted">Milestone payments currently run in test mode only. Real payments open after the payment provider and legal setup are approved.</p><a className="link" href="/help">Help centre</a></div>
          </div>
        </section>

        <section className="section">
          <div className="wrap">
            <div className="cta-band">
              <div><h2>Start with one account</h2><p style={{ opacity: 0.8 }}>Use the same login to find work and to hire.</p></div>
              <a className="btn lg" href="#signin">Get started</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="pub-foot">
        <div className="wrap">
          <span>© 2026 Freelance Income AI</span>
          <a href="/how-it-works">How it works</a>
          <a href="/pricing">Pricing</a>
          <a href="/safety">Safety</a>
          <a href="/help">Help</a>
        </div>
      </footer>
    </div>
  );
}
