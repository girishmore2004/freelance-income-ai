'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api, useSessionToken } from '@/lib/api-client';
import { routeCommand } from '@/lib/command-route';
import { isActive } from '@/lib/nav-active';
import {
  ACCOUNT_PAGES, HOME, MODE_EVENT, isAdminPath, modeForPath, publishWorkspace, readAdminSticky, readMode, saveAdminSticky, saveMode, workspaceFor,
  type Mode, type Workspace
} from '@/lib/mode';
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
  { label: 'Find work', items: [{ href: '/projects', label: 'Find work' }, { href: '/projects?view=saved', label: 'Saved projects' }, { href: '/projects?view=proposals', label: 'My proposals' }, { href: '/', label: 'External applications' }] },
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
/** Command bar examples for the active workspace only. */
const COMMAND_EXAMPLES: Record<'freelancer' | 'client' | 'admin', string[]> = {
  freelancer: ['What should I do next?', 'Summarise my earnings this month', 'Find projects for my skills', 'Which contract needs attention first?'],
  client: ['What should I do next?', 'Post a new project', 'Find freelancers', 'My spend', 'Contracts to review'],
  admin: ['Find a user', 'Platform earnings', 'Notifications', 'Security'],
};

const ROLES_HINT = 'fia_roles_hint';

/** Last roles seen in this browser: only to draw the right menu at once; the server still checks every request. */
function rolesHint(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(ROLES_HINT) || '[]');
    return Array.isArray(v) ? v.filter((r): r is string => typeof r === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Inside the app, moving between pages keeps the frame (no full reload, no
 * re-fetching the account, no flicker). Links with a query string still load
 * the page fully, because those pages read their view from the address once.
 */
function NavLink({ href, className, children, onClick, current, role }: { href: string; className?: string; children: ReactNode; onClick?: () => void; current?: boolean; role?: string }) {
  if (href.includes('?')) return <a className={className} href={href} onClick={onClick} aria-current={current ? 'page' : undefined} role={role}>{children}</a>;
  return <Link className={className} href={href} onClick={onClick} aria-current={current ? 'page' : undefined} role={role}>{children}</Link>;
}

/** Which sides the account has switched on (no freelancer or client role at all = the built-in freelancer side). */
function sidesOf(roles: string[]): Record<Mode, boolean> {
  const client = roles.includes('client');
  return { freelancer: roles.includes('freelancer') || !client, client };
}
const SIDE_NAME: Record<Mode, string> = { freelancer: 'Freelancer', client: 'Client (hiring)' };
const WORKSPACE_LABEL: Record<Workspace, string> = { freelancer: 'Freelancer workspace', client: 'Hiring workspace', admin: 'Admin workspace' };


export function AppFrame({ children }: { children: ReactNode }) {
  const [token, setToken] = useSessionToken();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const path = (pathname || '/').replace(/\/+$/, '') || '/';
  if (!token || !mounted || NO_FRAME.has(path)) return <>{children}</>;
  return <WorkspaceShell path={path} onSignedOut={() => setToken('')}>{children}</WorkspaceShell>;
}

function WorkspaceShell({ path, onSignedOut, children }: { path: string; onSignedOut: () => void; children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [hintRoles] = useState<string[]>(() => rolesHint());
  const [mode, setMode] = useState<Mode>(() => readMode() ?? 'freelancer');
  const [query, setQuery] = useState(() => window.location.search);
  const [adminSticky, setAdminSticky] = useState(() => readAdminSticky());
  const [unread, setUnread] = useState(0);
  const [usage, setUsage] = useState<{ today: number; daily: number } | null>(null);
  const [bySide, setBySide] = useState<{ freelancer: number; client: number; both: number } | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [command, setCommand] = useState('');
  const [roleBusy, setRoleBusy] = useState(false);
  const [roleError, setRoleError] = useState('');
  const profileRef = useRef<HTMLDivElement>(null);

  // The account and AI usage once per visit; the frame stays mounted while moving between pages.
  useEffect(() => {
    void (async () => {
      const [user, plan] = await Promise.all([
        api<Me>('/api/v1/me').catch(() => null),
        api<{ usage: { today: number }; limits: { daily: number } }>('/api/v1/me/plan').catch(() => null),
      ]);
      if (user && typeof user.id === 'string') {
        const roles = Array.isArray(user.roles) ? user.roles : [];
        setMe({ id: user.id, email: String(user.email ?? ''), roles });
        try { localStorage.setItem(ROLES_HINT, JSON.stringify(roles)); } catch { /* hint only */ }
      }
      if (plan && plan.usage && plan.limits && typeof plan.usage.today === 'number') setUsage({ today: plan.usage.today, daily: plan.limits.daily });
    })();
  }, []);

  // The unread count refreshes on every page, so the bell stays current after reading notifications.
  const loadUnread = useCallback(async () => {
    const count = await api<{ unread: number; by_side?: { freelancer: number; client: number; both: number } }>('/api/v1/notifications/unread-count').catch(() => null);
    if (count && typeof count.unread === 'number') {
      setUnread(count.unread);
      setBySide(count.by_side && typeof count.by_side.freelancer === 'number' ? count.by_side : null);
    }
  }, []);
  useEffect(() => { void loadUnread(); }, [path, loadUnread]);

  // Each page: read its query, remember whether the person is in Admin, and pick the side.
  useEffect(() => {
    const q = window.location.search;
    setQuery(q);
    if (isAdminPath(path, q)) { saveAdminSticky(true); setAdminSticky(true); }
    else if (!ACCOUNT_PAGES.includes(path)) { saveAdminSticky(false); setAdminSticky(false); }
    if (!me) return;
    const has = sidesOf(me.roles);
    // A page that belongs to one side always shows that side (never the other side's menu
    // around it); a shared page keeps the last choice, or the side the account has.
    const pageMode = modeForPath(path, q);
    const saved = readMode();
    const fallback: Mode = has.freelancer ? 'freelancer' : 'client';
    if (path === '/' && pageMode === 'freelancer' && !has.freelancer && has.client) {
      // A hiring-only account signing in on the home page goes to its own dashboard.
      saveMode('client');
      window.location.replace(HOME.client);
      return;
    }
    const next: Mode = pageMode ?? (saved && has[saved] ? saved : fallback);
    setMode(next);
    if (next !== saved) saveMode(next);
  }, [path, me]);

  // A page that switches the side itself (e.g. turning on hiring on Account) moves the frame with it.
  useEffect(() => {
    const onMode = (e: Event) => {
      const next = (e as CustomEvent<Mode>).detail;
      if (next !== 'freelancer' && next !== 'client') return;
      setMode(next);
      setMe((m) => (m && !m.roles.includes(next) ? { ...m, roles: [...m.roles, next] } : m));
    };
    window.addEventListener(MODE_EVENT, onMode);
    return () => window.removeEventListener(MODE_EVENT, onMode);
  }, []);

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

  const roles = me?.roles ?? hintRoles;
  const has = sidesOf(roles);
  const staff = roles.some((r) => STAFF_ROLES.includes(r));
  const workspace: Workspace = workspaceFor(path, query, staff, adminSticky, mode);
  // The switch shows only the sides the account has (sign-up: Find work, Hire or both; more from Account → Your roles).
  // A page of a side that is off still shows that side's button while it is open (with its "Turn on" offer).
  const known = Boolean(me) || roles.length > 0;
  const showSide: Record<Mode, boolean> = {
    freelancer: known && (has.freelancer || workspace === 'freelancer'),
    client: known && (has.client || workspace === 'client'),
  };
  const groups = useMemo(() => [...(workspace === 'admin' ? ADMIN : workspace === 'client' ? CLIENT : FREELANCER), ACCOUNT], [workspace]);
  // Each side has its own colour (globals.css: html[data-side]).
  useEffect(() => {
    document.documentElement.setAttribute('data-side', workspace);
    publishWorkspace(workspace);
    return () => document.documentElement.removeAttribute('data-side');
  }, [workspace]);
  // The bell counts the active side plus account-wide notifications; the other side shows a dot on its switch.
  // Admin shows the account-wide and staff notices only (they belong to neither side).
  const sideUnread = bySide ? (workspace === 'admin' ? bySide.both : bySide[workspace] + bySide.both) : unread;
  const otherUnread = (s: Mode) => (bySide && s !== workspace ? bySide[s] : 0);
  const initials = (me?.email ?? '?').slice(0, 2).toUpperCase();

  /** Switches a side on for this account (one login, two sides, like Upwork). */
  async function turnOn(side: Mode): Promise<boolean> {
    setRoleBusy(true);
    setRoleError('');
    try {
      const result = await api<{ roles: string[] }>('/api/v1/me/roles', 'POST', { role: side });
      const nextRoles = Array.isArray(result?.roles) ? result.roles : [...roles, side];
      setMe((m) => (m ? { ...m, roles: nextRoles } : m));
      return true;
    } catch (e) {
      setRoleError(e instanceof Error ? e.message : `Could not turn on the ${SIDE_NAME[side]} side.`);
      return false;
    } finally {
      setRoleBusy(false);
    }
  }

  async function switchMode(next: Workspace) {
    if (next === 'admin') {
      if (workspace !== 'admin') window.location.href = '/admin';
      return;
    }
    if (next === mode && workspace !== 'admin') return;
    // A side that is not on yet is switched on first (the account gets that role).
    if (me && !has[next] && !(await turnOn(next))) return;
    saveAdminSticky(false);
    setAdminSticky(false);
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
    // Each side searches its own marketplace: freelancers search projects, clients search freelancers.
    const base = workspace === 'client' ? '/freelancers' : '/projects';
    window.location.href = q ? `${base}?q=${encodeURIComponent(q)}` : base;
  }

  function submitCommand(e: FormEvent) {
    e.preventDefault();
    window.location.href = routeCommand(command, workspace);
  }

  async function signOut() {
    try {
      await api('/api/v1/auth/logout', 'POST', {});
    } catch {
      // Signing out locally still ends this browser's session.
    }
    onSignedOut();
    try {
      // The next person on this browser starts from their own sides.
      localStorage.removeItem(ROLES_HINT);
      localStorage.removeItem('fia_mode');
    } catch {
      // Storage unavailable: nothing stored.
    }
    window.location.href = '/';
  }

  return (
    <div className="ws">
      <a className="skip" href="#ws-content">Skip to content</a>
      <div className={`scrim${drawer ? ' show' : ''}`} onClick={() => setDrawer(false)} aria-hidden="true" />
      <aside className={`ws-side${drawer ? ' open' : ''}`} aria-label="Workspace navigation">
        <Link className="side-brand" href="/workspace"><span className="logo" aria-hidden="true">F</span><div><div className="brand-name">Freelance Income AI</div><div className="brand-sub">{WORKSPACE_LABEL[workspace]}</div></div></Link>
        {/* On phones the top bar has no room for search and the AI command; they live here instead. */}
        <div className="side-tools">
          <form role="search" onSubmit={(e) => { setDrawer(false); submitSearch(e); }}>
            <label htmlFor="ws-search-m" className="sr-only">Search from the menu</label>
            <input id="ws-search-m" type="search" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} placeholder={workspace === 'client' ? 'Search freelancers and skills' : 'Search projects and skills'} />
          </form>
          <form onSubmit={(e) => { setDrawer(false); submitCommand(e); }}>
            <label htmlFor="ws-cmd-m" className="sr-only">Ask AI from the menu</label>
            <input id="ws-cmd-m" list="ws-cmd-examples" value={command} onChange={(e) => setCommand(e.target.value)} maxLength={500} placeholder="Ask AI or jump to…" />
          </form>
        </div>
        {groups.map((g) => (
          <nav key={g.label} aria-label={g.label}>
            <div className="nav-label">{g.label}</div>
            <div className="nav">
              {g.items.map((i) => (
                <NavLink key={i.href + i.label} className="nav-item" href={i.href} current={isActive(path, i.href, query, g.items.map((x) => x.href))} onClick={() => setDrawer(false)}>
                  <span className="nav-text">{i.label}</span>
                  {i.href === '/notifications' && sideUnread > 0 && <span className="count" aria-label={`${sideUnread} unread`}>{sideUnread > 99 ? '99+' : sideUnread}</span>}
                </NavLink>
              ))}
            </div>
          </nav>
        ))}
      </aside>

      <div className="ws-body">
        <header className="ws-top">
          <button type="button" className="icon-btn menu" aria-label="Open navigation" aria-expanded={drawer} onClick={() => setDrawer(true)}>
            <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          {(showSide.freelancer || showSide.client || staff) && <div className="ws-role" role="group" aria-label="Workspace">
            {showSide.freelancer && <button type="button" className="side-f" disabled={roleBusy} aria-pressed={workspace === 'freelancer'} onClick={() => void switchMode('freelancer')}>
              Freelancer{otherUnread('freelancer') > 0 && <span className="side-dot" aria-label={`${otherUnread('freelancer')} unread`} />}
            </button>}
            {showSide.client && <button type="button" className="side-c" disabled={roleBusy} aria-pressed={workspace === 'client'} onClick={() => void switchMode('client')}>
              Client{otherUnread('client') > 0 && <span className="side-dot" aria-label={`${otherUnread('client')} unread`} />}
            </button>}
            {staff && <button type="button" className="side-a" aria-pressed={workspace === 'admin'} onClick={() => void switchMode('admin')}>Admin</button>}
          </div>}
          <form className="ws-search" role="search" onSubmit={submitSearch}>
            <label htmlFor="ws-search" className="sr-only">Global search</label>
            <input id="ws-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} placeholder={workspace === 'client' ? 'Search freelancers and skills' : 'Search projects and skills'} />
          </form>
          <form className="ws-cmd" onSubmit={submitCommand}>
            <label htmlFor="ws-cmd" className="sr-only">AI command</label>
            <input id="ws-cmd" list="ws-cmd-examples" value={command} onChange={(e) => setCommand(e.target.value)} maxLength={500} placeholder="Ask AI or jump to… (e.g. what should I do next?)" />
            <datalist id="ws-cmd-examples">
              {COMMAND_EXAMPLES[workspace].map((x) => <option key={x} value={x} />)}
            </datalist>
          </form>
          <span className="spacer" />
          {usage && <span className="ws-usage" title="AI drafts used today and your daily limit">AI today {usage.today}/{usage.daily}</span>}
          <ThemeToggle />
          <Link className="icon-btn" href="/notifications" aria-label={sideUnread ? `Notifications, ${sideUnread} unread` : 'Notifications'}>
            <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></svg>
            {sideUnread > 0 && <span className="dot">{sideUnread > 9 ? '9+' : sideUnread}</span>}
          </Link>
          <div className="rel" ref={profileRef}>
            <button type="button" className="avatar" style={{ border: 0, cursor: 'pointer' }} aria-haspopup="menu" aria-expanded={profileOpen} aria-label="Profile menu" onClick={() => setProfileOpen((v) => !v)}>{initials}</button>
            {profileOpen && (
              <div className="menu-pop" role="menu">
                <p className="muted small" style={{ padding: '6px 10px', margin: 0 }}>{me?.email}</p>
                <Link role="menuitem" href="/account" onClick={() => setProfileOpen(false)}>Account and team</Link>
                <Link role="menuitem" href="/security" onClick={() => setProfileOpen(false)}>Security</Link>
                <button role="menuitem" type="button" onClick={() => void signOut()}>Sign out</button>
              </div>
            )}
          </div>
        </header>
        <div className="ws-main" id="ws-content">
          {roleError && <p className="error" role="alert">{roleError}</p>}
          {me && workspace !== 'admin' && !has[workspace] && (
            <div className="card notice" role="status">
              <p>This is a {SIDE_NAME[workspace]} page, and the {SIDE_NAME[workspace]} side is not on for your account yet.</p>
              <div className="row">
                <button type="button" className="btn primary" disabled={roleBusy} onClick={() => void turnOn(workspace)}>Turn on the {SIDE_NAME[workspace]} side</button>
                <a className="btn" href={HOME[workspace === 'client' ? 'freelancer' : 'client']} onClick={() => saveMode(workspace === 'client' ? 'freelancer' : 'client')}>Go to my {SIDE_NAME[workspace === 'client' ? 'freelancer' : 'client']} dashboard</a>
              </div>
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
