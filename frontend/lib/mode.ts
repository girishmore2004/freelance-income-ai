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

/** Where a side starts after switching from a page of the other side. */
export const HOME: Record<Mode, string> = { freelancer: '/workspace', client: '/workspace' };

export function readMode(): Mode | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'client' || v === 'freelancer' ? v : null;
  } catch {
    return null;
  }
}

export function saveMode(mode: Mode): void {
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
  const [mode, setMode] = useState<Mode>('freelancer');
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
