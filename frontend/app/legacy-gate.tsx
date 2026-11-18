'use client';
import type { ReactNode } from 'react';
import { useSessionToken } from '@/lib/api-client';

/**
 * Pages whose API lives only in the Python service, which is not deployed
 * (decision D-11, K-01). Instead of failing request after request, they show
 * what is not available yet and where the same job is done today. Setting the
 * build variable NEXT_PUBLIC_LEGACY_PYTHON_PAGES=true renders the original
 * page again (only useful once its routes are served).
 */

export const LEGACY_PAGES_ENABLED = process.env.NEXT_PUBLIC_LEGACY_PYTHON_PAGES === 'true';

export function LegacyGate({ title, summary, alternatives, children }: { title: string; summary: string; alternatives: Array<{ href: string; label: string; note: string }>; children: ReactNode }) {
  const [token] = useSessionToken();
  if (LEGACY_PAGES_ENABLED) return <>{children}</>;
  if (!token) return <main className="shell"><div className="card"><h2>{title}</h2><p className="muted">Sign in first to use this page.</p><a className="btn" href="/">Go to sign in</a></div></main>;
  return (
    <main className="shell">
      <section className="card" aria-labelledby="legacy-heading">
        <h2 id="legacy-heading">{title}</h2>
        <p>{summary}</p>
        <p className="muted">This tool runs on the older Python service, which is not running yet, so it is switched off here instead of showing errors. Your data is safe; nothing was deleted.</p>
        <h3>Do this today</h3>
        <ul>
          {alternatives.map((a) => <li key={a.href}><a className="link" href={a.href}>{a.label}</a> — {a.note}</li>)}
        </ul>
        <a className="btn" href="/">Back to dashboard</a>
      </section>
    </main>
  );
}
