'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, useSessionToken } from '@/lib/api-client';
import { routeCommand } from '@/lib/command-route';

/**
 * One frame for every signed-in page (PRODUCT_EXPERIENCE_SPEC §3, §7, §15–16):
 * a role-aware sidebar (freelancer, client, staff), a top bar with global
 * search, an AI command input, notifications, AI usage and a profile menu,
 * and a mobile drawer. Visitors and the public pages get no frame. Only pages
 * that exist are linked: no dead navigation.
 */

type Mode = 'freelancer' | 'client';
type Me = { id: string; email: string; roles: string[] };
type NavItem = { href: string; label: string; match?: string[] };
type NavGroup = { label: string; items: NavItem[] };

/** Paths that never get the workspace frame (public website and join links). `/` is the public homepage for visitors and the external-opportunity dashboard once signed in. */
const NO_FRAME = new Set(['/how-it-works', '/pricing', '/safety', '/help', '/join', '/about']);

const FREELANCER: NavGroup[] = [
  { label: 'Home', items: [{ href: '/workspace', label: 'Overview' }, { href: '/agent', label: 'Next actions' }, { href: '/calendar', label: 'Calendar' }, { href: '/analytics', label: 'Analytics' }] },
  { label: 'Find work', items: [{ href: '/projects', label: 'Find work' }, { href: '/projects?view=saved', label: 'Saved projects' }, { href: '/', label: 'Proposals and applications' }] },
  { label: 'Work', items: [{ href: '/contracts', label: 'Offers and contracts' }, { href: '/earnings', label: 'Earnings and payouts' }] },
  { label: 'AI', items: [{ href: '/ai-agents', label: 'AI agent centre' }, { href: '/coach', label: 'Business coach' }] },
];
const CLIENT: NavGroup[] = [
  { label: 'Home', items: [{ href: '/workspace', label: 'Overview' }, { href: '/agent', label: 'Next actions' }, { href: '/calendar', label: 'Calendar' }, { href: '/analytics', label: 'Analytics' }] },
  { label: 'Hiring', items: [{ href: '/client/projects', label: 'Projects and proposals' }, { href: '/freelancers', label: 'Find freelancers' }] },
  { label: 'Work', items: [{ href: '/contracts', label: 'Contracts and deliveries' }] },
  { label: 'AI', items: [{ href: '/ai-agents', label: 'AI agent centre' }] },
];
const ACCOUNT: NavGroup = { label: 'Account', items: [{ href: '/notifications', label: 'Notifications' }, { href: '/account', label: 'Account and team' }, { href: '/security', label: 'Security' }, { href: '/contact', label: 'Help and support' }] };
const STAFF: NavGroup = { label: 'Staff', items: [{ href: '/admin', label: 'Admin' }, { href: '/finance', label: 'Finance' }] };

function isActive(path: string, href: string): boolean {
  if (href === '/') return path === '/';
  return path === href || path.startsWith(`${href}/`);
}

function readMode(): Mode | null {
  try {
    const v = localStorage.getItem('fia_mode');
    return v === 'client' || v === 'freelancer' ? v : null;
  } catch {
    return null;
  }
}

function saveMode(mode: Mode): void {
  try {
    localStorage.setItem('fia_mode', mode);
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
}

export function AppFrame({ children }: { children: ReactNode }) {
  const [token, setToken] = useSessionToken();
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => { setPath(window.location.pathname.replace(/\/+$/, '') || '/'); }, []);
  if (!token || path === null || NO_FRAME.has(path)) return <>{children}</>;
  return <WorkspaceShell path={path} onSignedOut={() => setToken('')}>{children}</WorkspaceShell>;
}

function WorkspaceShell({ path, onSignedOut, children }: { path: string; onSignedOut: () => void; children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [mode, setMode] = useState<Mode>('freelancer');
  const [unread, setUnread] = useState(0);
  const [usage, setUsage] = useState<{ today: number; daily: number } | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [command, setCommand] = useState('');
  const profileRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [user, count, plan] = await Promise.all([
      api<Me>('/api/v1/me').catch(() => null),
      api<{ unread: number }>('/api/v1/notifications/unread-count').catch(() => null),
      api<{ usage: { today: number }; limits: { daily: number } }>('/api/v1/me/plan').catch(() => null),
    ]);
    if (user && typeof user.id === 'string') {
      const roles = Array.isArray(user.roles) ? user.roles : [];
      setMe({ id: user.id, email: String(user.email ?? ''), roles });
      const saved = readMode();
      const preferred: Mode = path.startsWith('/client') ? 'client' : saved ?? (roles.includes('freelancer') || !roles.includes('client') ? 'freelancer' : 'client');
      setMode(preferred === 'client' && !roles.includes('client') ? 'freelancer' : preferred);
    }
    if (count && typeof count.unread === 'number') setUnread(count.unread);
    if (plan && plan.usage && plan.limits && typeof plan.usage.today === 'number') setUsage({ today: plan.usage.today, daily: plan.limits.daily });
  }, [path]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!profileOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !profileRef.current?.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [profileOpen]);

  const roles = me?.roles ?? [];
  const canClient = roles.includes('client');
  const canFreelance = roles.includes('freelancer') || !canClient;
  const staff = roles.some((r) => ['admin', 'finance', 'moderator'].includes(r));
  const groups = useMemo(() => [...(mode === 'client' ? CLIENT : FREELANCER), ACCOUNT, ...(staff ? [STAFF] : [])], [mode, staff]);
  const initials = (me?.email ?? '?').slice(0, 2).toUpperCase();

  function switchMode(next: Mode) {
    setMode(next);
    saveMode(next);
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    const q = search.trim();
    window.location.href = q ? `/projects?q=${encodeURIComponent(q)}` : '/projects';
  }

  function submitCommand(e: FormEvent) {
    e.preventDefault();
    window.location.href = routeCommand(command);
  }

  async function signOut() {
    try {
      await api('/api/v1/auth/logout', 'POST', {});
    } catch {
      // Signing out locally still ends this browser's session.
    }
    onSignedOut();
    window.location.href = '/';
  }

  return (
    <div className="ws">
      <a className="skip" href="#ws-content">Skip to content</a>
      <div className={`scrim${drawer ? ' show' : ''}`} onClick={() => setDrawer(false)} aria-hidden="true" />
      <aside className={`ws-side${drawer ? ' open' : ''}`} aria-label="Workspace navigation">
        <a className="side-brand" href="/workspace"><span className="logo" aria-hidden="true">F</span><div><div className="brand-name">Freelance Income AI</div><div className="brand-sub">{mode === 'client' ? 'Hiring workspace' : 'Freelancer workspace'}</div></div></a>
        {canClient && canFreelance && (
          <div className="ws-role" role="group" aria-label="Workspace">
            <button type="button" aria-pressed={mode === 'freelancer'} onClick={() => switchMode('freelancer')}>Freelancer</button>
            <button type="button" aria-pressed={mode === 'client'} onClick={() => switchMode('client')}>Client</button>
          </div>
        )}
        {groups.map((g) => (
          <nav key={g.label} aria-label={g.label}>
            <div className="nav-label">{g.label}</div>
            <div className="nav">
              {g.items.map((i) => (
                <a key={i.href + i.label} className="nav-item" href={i.href} aria-current={isActive(path, i.href) ? 'page' : undefined} onClick={() => setDrawer(false)}>
                  <span className="nav-text">{i.label}</span>
                  {i.href === '/notifications' && unread > 0 && <span className="count" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>}
                </a>
              ))}
            </div>
          </nav>
        ))}
        {canFreelance && !canClient && (
          <p className="muted small" style={{ padding: '12px 12px 0' }}>Want to hire too? <a className="link" href="/account">Turn on the client role</a>.</p>
        )}
      </aside>

      <div className="ws-body">
        <header className="ws-top">
          <button type="button" className="icon-btn menu" aria-label="Open navigation" aria-expanded={drawer} onClick={() => setDrawer(true)}>
            <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <form className="ws-search" role="search" onSubmit={submitSearch}>
            <label htmlFor="ws-search" className="sr-only">Global search</label>
            <input id="ws-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} placeholder="Search projects and skills" />
          </form>
          <form className="ws-cmd" onSubmit={submitCommand}>
            <label htmlFor="ws-cmd" className="sr-only">AI command</label>
            <input id="ws-cmd" list="ws-cmd-examples" value={command} onChange={(e) => setCommand(e.target.value)} maxLength={500} placeholder="Ask AI or jump to… (e.g. what should I do next?)" />
            <datalist id="ws-cmd-examples">
              <option value="What should I do next?" />
              <option value="Summarise my earnings this month" />
              <option value="Find projects for my skills" />
              <option value="Which contract needs attention first?" />
              <option value="Post a new project" />
            </datalist>
          </form>
          <span className="spacer" />
          {usage && <span className="ws-usage" title="AI drafts used today and your daily limit">AI today {usage.today}/{usage.daily}</span>}
          <a className="icon-btn" href="/notifications" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
            <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></svg>
            {unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
          </a>
          <div className="rel" ref={profileRef}>
            <button type="button" className="avatar" style={{ border: 0, cursor: 'pointer' }} aria-haspopup="menu" aria-expanded={profileOpen} aria-label="Profile menu" onClick={() => setProfileOpen((v) => !v)}>{initials}</button>
            {profileOpen && (
              <div className="menu-pop" role="menu">
                <p className="muted small" style={{ padding: '6px 10px', margin: 0 }}>{me?.email}</p>
                <a role="menuitem" href="/account">Account and team</a>
                <a role="menuitem" href="/security">Security</a>
                <button role="menuitem" type="button" onClick={() => void signOut()}>Sign out</button>
              </div>
            )}
          </div>
        </header>
        <div className="ws-main" id="ws-content">{children}</div>
      </div>
    </div>
  );
}
