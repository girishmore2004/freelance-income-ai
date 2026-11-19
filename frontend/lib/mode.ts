'use client';
import { useEffect, useState } from 'react';

/**
 * Freelancer / Client mode (one account, two sides, like Upwork and Fiverr).
 * Exactly one side is active at a time: the sidebar, the shared pages
 * (contracts, inbox, calendar, analytics) and their lists follow it, and a
 * page that belongs to the other side switches the mode when opened.
 */

export type Mode = 'freelancer' | 'client';
export const MODE_EVENT = 'fia-mode';
const KEY = 'fia_mode';

/** Freelancer-only pages, including the older tools for a freelancer's own clients, invoices and job sources. */
const FREELANCER_PAGES = ['/', '/projects', '/profile', '/opportunities', '/coach', '/clients', '/client-insights', '/opportunity-intelligence', '/marketplaces', '/delivery', '/agent-workflows', '/payments', '/analytics/planning'];

/** The side a page belongs to, or null for pages both sides use. Pure. */
export function modeForPath(pathname: string, search = ''): Mode | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(search);
  if (path === '/client' || path.startsWith('/client/') || path === '/freelancers') return 'client';
  if (path === '/earnings') return params.get('view') === 'client' ? 'client' : 'freelancer';
  if (path === '/services') return params.get('view') === 'mine' ? 'freelancer' : 'client';
  if (FREELANCER_PAGES.includes(path)) return 'freelancer';
  return null;
}

/** The side a link opens (pages, contract links are shared). Pure. */
export function sideOfHref(href: string | null | undefined): Mode | null {
  if (!href || !href.startsWith('/')) return null;
  const [pathAndSearch] = href.split('#');
  const q = pathAndSearch.indexOf('?');
  return modeForPath(q < 0 ? pathAndSearch : pathAndSearch.slice(0, q), q < 0 ? '' : pathAndSearch.slice(q));
}

/**
 * Whether an item (action, alert, recommendation) belongs on the active side:
 * its own side when the server tags it, otherwise the side of the page it opens.
 * Account-wide items show on both sides. Pure.
 */
export function onSide(item: { side?: Mode | null; href?: string | null }, mode: Mode): boolean {
  if (item.side) return item.side === mode;
  const side = sideOfHref(item.href);
  return !side || side === mode;
}

/** Where a side starts after switching from a page of the other side. */
export const HOME: Record<Mode, string> = { freelancer: '/workspace', client: '/workspace' };

/** The side as last seen on this page, so pages opened inside the app start on the right side (no flicker). */
let knownMode: Mode | undefined;

export function readMode(): Mode | null {
  try {
    const v = localStorage.getItem(KEY);
    const m = v === 'client' || v === 'freelancer' ? v : null;
    if (m) knownMode = m;
    return m;
  } catch {
    return null;
  }
}

export function saveMode(mode: Mode): void {
  knownMode = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
  try {
    window.dispatchEvent(new CustomEvent(MODE_EVENT, { detail: mode }));
  } catch {
    // No window (server render): nothing to tell.
  }
}

/** The active side for pages both sides use; follows the sidebar switch live. */
export function useMode(): Mode {
  const [mode, setMode] = useState<Mode>(() => knownMode ?? 'freelancer');
  useEffect(() => {
    setMode(readMode() ?? 'freelancer');
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<Mode>).detail;
      if (next === 'client' || next === 'freelancer') setMode(next);
    };
    window.addEventListener(MODE_EVENT, onChange);
    return () => window.removeEventListener(MODE_EVENT, onChange);
  }, []);
  return mode;
}

/* ------------------------------------------------------------------ */
/* Workspace: the two sides plus the staff-only Admin workspace        */
/* ------------------------------------------------------------------ */

export type Workspace = Mode | 'admin';
export const WORKSPACE_EVENT = 'fia-workspace';
const ADMIN_KEY = 'fia_admin_ws';

/** Account pages every workspace links to; opened from Admin they stay in Admin. */
export const ACCOUNT_PAGES = ['/notifications', '/account', '/security', '/contact'];

/** Staff pages that always form the Admin workspace. Pure. */
export function isAdminPath(pathname: string, search = ''): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  const view = new URLSearchParams(search).get('view');
  return path === '/admin' || path.startsWith('/admin/') || path === '/finance' || path.startsWith('/finance/') || (path === '/analytics' && view === 'platform') || (path === '/ai-agents' && view === 'admin');
}

/**
 * Which workspace a page shows. Pure.
 * - Staff pages are Admin.
 * - Account pages (notifications, account, security, help) stay in Admin when the person came from Admin.
 * - A page of one side shows that side; other shared pages follow the chosen side.
 */
export function workspaceFor(pathname: string, search: string, staff: boolean, adminSticky: boolean, mode: Mode): Workspace {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (staff && isAdminPath(path, search)) return 'admin';
  if (staff && adminSticky && ACCOUNT_PAGES.includes(path)) return 'admin';
  return modeForPath(path, search) ?? mode;
}

export function readAdminSticky(): boolean {
  try {
    return localStorage.getItem(ADMIN_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveAdminSticky(on: boolean): void {
  try {
    if (on) localStorage.setItem(ADMIN_KEY, '1');
    else localStorage.removeItem(ADMIN_KEY);
  } catch {
    // Storage unavailable: Admin lasts for this page only.
  }
}

let knownWorkspace: Workspace | undefined;

/** Called by the frame whenever the workspace it shows changes. */
export function publishWorkspace(ws: Workspace): void {
  knownWorkspace = ws;
  try {
    window.dispatchEvent(new CustomEvent(WORKSPACE_EVENT, { detail: ws }));
  } catch {
    // No window (server render).
  }
}

/** The workspace the frame shows (freelancer, client or admin), for pages that list items of all kinds. */
export function useWorkspace(): Workspace {
  const mode = useMode();
  const [ws, setWs] = useState<Workspace | undefined>(() => knownWorkspace);
  useEffect(() => {
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<Workspace>).detail;
      if (next === 'admin' || next === 'client' || next === 'freelancer') setWs(next);
    };
    window.addEventListener(WORKSPACE_EVENT, onChange);
    return () => window.removeEventListener(WORKSPACE_EVENT, onChange);
  }, []);
  return ws ?? mode;
}
