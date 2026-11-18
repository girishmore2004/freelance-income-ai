'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, useSessionToken } from '@/lib/api-client';
import { routeCommand } from '@/lib/command-route';
import { HOME, modeForPath, readMode, saveMode, type Mode } from '@/lib/mode';
import { ThemeToggle } from './theme-toggle';

/**
 * One frame for every signed-in page (PRODUCT_EXPERIENCE_SPEC §3, §7, §15–16):
 * a role-aware sidebar (freelancer, client, staff), a top bar with global
 * search, an AI command input, notifications, AI usage and a profile menu,
 * and a mobile drawer. Visitors and the public pages get no frame. Only pages
 * that exist are linked: no dead navigation.
 */

type Me = { id: string; email: string; roles: string[] };
type NavItem = { href: string; label: string; match?: string[] };
type NavGroup = { label: string; items: NavItem[] };

/** Paths that never get the workspace frame (public website and join links). `/` is the public homepage for visitors and the external-opportunity dashboard once signed in. */
const NO_FRAME = new Set(['/how-it-works', '/pricing', '/safety', '/help', '/join', '/about']);

const FREELANCER: NavGroup[] = [
  { label: 'Home', items: [{ href: '/workspace', label: 'Overview' }, { href: '/agent', label: 'Next actions' }, { href: '/inbox', label: 'Inbox' }, { href: '/calendar', label: 'Calendar' }, { href: '/analytics', label: 'Analytics' }] },
  { label: 'Profile', items: [{ href: '/profile', label: 'My profile and resume' }, { href: '/services?view=mine', label: 'My services' }] },
  { label: 'Find work', items: [{ href: '/projects', label: 'Find work' }, { href: '/projects?view=saved', label: 'Saved projects' }, { href: '/', label: 'My proposals' }] },
  { label: 'Work', items: [{ href: '/contracts', label: 'Offers and contracts' }, { href: '/earnings', label: 'Earnings and payouts' }] },
  { label: 'AI', items: [{ href: '/ai-agents', label: 'AI agent centre' }, { href: '/coach', label: 'Business coach' }] },
];
const CLIENT: NavGroup[] = [
  { label: 'Home', items: [{ href: '/workspace', label: 'Overview' }, { href: '/agent', label: 'Next actions' }, { href: '/inbox', label: 'Inbox' }, { href: '/calendar', label: 'Calendar' }, { href: '/analytics', label: 'Analytics' }] },
  { label: 'Hiring', items: [{ href: '/client/projects', label: 'Projects and proposals' }, { href: '/freelancers', label: 'Find freelancers' }, { href: '/services', label: 'Buy a service' }] },
  { label: 'Work', items: [{ href: '/contracts', label: 'Contracts and deliveries' }, { href: '/earnings?view=client', label: 'Spend and statements' }] },
  { label: 'AI', items: [{ href: '/ai-agents', label: 'AI agent centre' }] },
];
const ACCOUNT: NavGroup = { label: 'Account', items: [{ href: '/notifications', label: 'Notifications' }, { href: '/account', label: 'Account and team' }, { href: '/security', label: 'Security' }, { href: '/contact', label: 'Help and support' }] };
/** The Admin workspace (staff only): its own sidebar, opened from the top-bar switch. */
const ADMIN: NavGroup[] = [
  { label: 'Platform', items: [{ href: '/admin', label: 'Admin overview' }, { href: '/analytics?view=platform', label: 'Platform analytics' }] },
  { label: 'Trust and safety', items: [
    { href: '/admin#queue-heading', label: 'Moderation queue' }, { href: '/admin#svc-mod-heading', label: 'Services review' }, { href: '/admin#reports-heading', label: 'Reports' },
    { href: '/admin#disputes-heading', label: 'Disputes' }, { href: '/admin#suspensions-heading', label: 'Suspensions' }, { href: '/admin#verify-heading', label: 'Verification' },
  ] },
  { label: 'Operations', items: [
    { href: '/admin#users-heading', label: 'Users' }, { href: '/admin#support-heading', label: 'Support tickets' }, { href: '/admin#categories-heading', label: 'Categories' },
    { href: '/admin#sources-heading', label: 'Job sources' }, { href: '/admin#flags-heading', label: 'Feature flags' }, { href: '/admin#health-heading', label: 'System health' }, { href: '/admin#audit-heading', label: 'Audit log' },
  ] },
  { label: 'Money', items: [{ href: '/finance', label: 'Finance and fees' }, { href: '/finance#plans-heading', label: 'Plans and AI credits' }] },
  { label: 'AI', items: [{ href: '/ai-agents?view=admin', label: 'AI agents on/off' }] },
];
const STAFF_ROLES = ['admin', 'finance', 'moderator'];
type Workspace = Mode | 'admin';
const WORKSPACE_LABEL: Record<Workspace, string> = { freelancer: 'Freelancer workspace', client: 'Hiring workspace', admin: 'Admin workspace' };

/** Staff pages form the Admin workspace. */
function isAdminPath(path: string, search: string): boolean {
  const view = new URLSearchParams(search).get('view');
  return path === '/admin' || path.startsWith('/admin/') || path === '/finance' || path.startsWith('/finance/') || (path === '/analytics' && view === 'platform') || (path === '/ai-agents' && view === 'admin');
}

function isActive(path: string, href: string): boolean {
  if (href === '/') return path === '/';
  return path === href || path.startsWith(`${href}/`);
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
  const [bySide, setBySide] = useState<{ freelancer: number; client: number; both: number } | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [command, setCommand] = useState('');
  const profileRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [user, count, plan] = await Promise.all([
      api<Me>('/api/v1/me').catch(() => null),
      api<{ unread: number; by_side?: { freelancer: number; client: number; both: number } }>('/api/v1/notifications/unread-count').catch(() => null),
      api<{ usage: { today: number }; limits: { daily: number } }>('/api/v1/me/plan').catch(() => null),
    ]);
    if (user && typeof user.id === 'string') {
      const roles = Array.isArray(user.roles) ? user.roles : [];
      setMe({ id: user.id, email: String(user.email ?? ''), roles });
      const canBeClient = roles.includes('client');
      const canBeFreelancer = roles.includes('freelancer') || !canBeClient;
      const allowed = (m: Mode | null): m is Mode => (m === 'client' ? canBeClient : m === 'freelancer' ? canBeFreelancer : false);
      // A page that belongs to one side switches to it; otherwise the last choice; otherwise the account's side.
      const pageMode = modeForPath(path, window.location.search);
      const saved = readMode();
      const next: Mode = allowed(pageMode) ? pageMode : allowed(saved) ? saved : canBeFreelancer ? 'freelancer' : 'client';
      setMode(next);
      if (next !== saved) saveMode(next);
    }
    if (count && typeof count.unread === 'number') {
      setUnread(count.unread);
      setBySide(count.by_side && typeof count.by_side.freelancer === 'number' ? count.by_side : null);
    }
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
  const staff = roles.some((r) => STAFF_ROLES.includes(r));
  const search0 = typeof window === 'undefined' ? '' : window.location.search;
  const workspace: Workspace = staff && isAdminPath(path, search0) ? 'admin' : mode;
  const groups = useMemo(() => [...(workspace === 'admin' ? ADMIN : workspace === 'client' ? CLIENT : FREELANCER), ACCOUNT], [workspace]);
  // Each side has its own colour (globals.css: html[data-side]).
  useEffect(() => {
    document.documentElement.setAttribute('data-side', workspace);
    return () => document.documentElement.removeAttribute('data-side');
  }, [workspace]);
  // The bell counts the active side plus account-wide notifications; the other side shows a dot on its switch.
  const sideUnread = bySide ? (workspace === 'admin' ? unread : bySide[workspace] + bySide.both) : unread;
  const otherUnread = (s: Mode) => (bySide && s !== workspace ? bySide[s] : 0);
  const initials = (me?.email ?? '?').slice(0, 2).toUpperCase();

  function switchMode(next: Workspace) {
    if (next === 'admin') {
      if (workspace !== 'admin') window.location.href = '/admin';
      return;
    }
    if (next === mode && workspace !== 'admin') return;
    setMode(next);
    saveMode(next);
    if (workspace === 'admin') {
      window.location.href = HOME[next];
      return;
    }
    // Leaving a page of the other side: start at this side's home so nothing is mixed.
    const pageMode = modeForPath(path, window.location.search);
    if (pageMode && pageMode !== next) window.location.href = HOME[next];
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
        <a className="side-brand" href="/workspace"><span className="logo" aria-hidden="true">F</span><div><div className="brand-name">Freelance Income AI</div><div className="brand-sub">{WORKSPACE_LABEL[workspace]}</div></div></a>
        {groups.map((g) => (
          <nav key={g.label} aria-label={g.label}>
            <div className="nav-label">{g.label}</div>
            <div className="nav">
              {g.items.map((i) => (
                <a key={i.href + i.label} className="nav-item" href={i.href} aria-current={isActive(path, i.href) ? 'page' : undefined} onClick={() => setDrawer(false)}>
                  <span className="nav-text">{i.label}</span>
                  {i.href === '/notifications' && sideUnread > 0 && <span className="count" aria-label={`${sideUnread} unread`}>{sideUnread > 99 ? '99+' : sideUnread}</span>}
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
          {(canClient && canFreelance) || staff ? (
            <div className="ws-role" role="group" aria-label="Workspace">
              {canFreelance && (
                <button type="button" className="side-f" aria-pressed={workspace === 'freelancer'} onClick={() => switchMode('freelancer')}>
                  Freelancer{otherUnread('freelancer') > 0 && <span className="side-dot" aria-label={`${otherUnread('freelancer')} unread`} />}
                </button>
              )}
              {canClient && (
                <button type="button" className="side-c" aria-pressed={workspace === 'client'} onClick={() => switchMode('client')}>
                  Client{otherUnread('client') > 0 && <span className="side-dot" aria-label={`${otherUnread('client')} unread`} />}
                </button>
              )}
              {staff && <button type="button" className="side-a" aria-pressed={workspace === 'admin'} onClick={() => switchMode('admin')}>Admin</button>}
            </div>
          ) : null}
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
          <ThemeToggle />
          <a className="icon-btn" href="/notifications" aria-label={sideUnread ? `Notifications, ${sideUnread} unread` : 'Notifications'}>
            <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></svg>
            {sideUnread > 0 && <span className="dot">{sideUnread > 9 ? '9+' : sideUnread}</span>}
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
