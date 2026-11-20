'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

/**
 * Step-by-step start for new users (U31, founder decision D-31). The overview shows a
 * "Get started" list per side; forms mark required fields with ★; pages warn (never
 * block) when a profile or billing detail is missing.
 */

export type Side = 'client' | 'freelancer';
type Gap = { key: string; label: string };
type Step = { key: string; label: string; why: string; href: string; done: boolean };
export type Onboarding = { applies: boolean; side: Side; steps: Step[]; next: string | null; done: number; total: number; complete: boolean; profile_gaps: Gap[]; billing_gaps: Gap[] };

/** ★ after a label; screen readers hear "(required)". */
export function Req() {
  return <><span className="req" aria-hidden="true"> ★</span><span className="sr-only"> (required)</span></>;
}

export function RequiredNote({ text = 'required' }: { text?: string }) {
  return <p className="muted small"><span className="req" aria-hidden="true">★</span> = {text}</p>;
}

/** The signed-in person's setup for one side; null while loading or when unavailable. */
export function useOnboarding(side: Side, refresh = 0): Onboarding | null {
  const [data, setData] = useState<Onboarding | null>(null);
  useEffect(() => {
    let live = true;
    api<Onboarding>(`/api/v1/me/onboarding?side=${side}`)
      .then((d) => { if (live) setData(d && Array.isArray(d.steps) ? d : null); })
      .catch(() => { if (live) setData(null); });
    return () => { live = false; };
  }, [side, refresh]);
  return data;
}

/** Overview card: each step with Done / Next and a button to do it. Hidden once complete. */
export function GetStarted({ side }: { side: Side }) {
  const data = useOnboarding(side);
  if (!data || !data.applies || data.complete || !data.steps.length) return null;
  const pct = Math.round((data.done / data.total) * 100);
  return (
    <section className="card get-started" aria-labelledby="get-started-heading">
      <div className="row between">
        <h2 id="get-started-heading">Get started</h2>
        <span className="muted small">{data.done} of {data.total} done</span>
      </div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Setup progress"><span style={{ width: `${pct}%` }} /></div>
      <ol>
        {data.steps.map((s, i) => {
          const state = s.done ? 'done' : s.key === data.next ? 'next' : 'todo';
          return (
            <li key={s.key} className={state} aria-current={state === 'next' ? 'step' : undefined}>
              <span className="mark" aria-hidden="true">{s.done ? '✓' : i + 1}</span>
              <div style={{ flex: 1 }}>
                <b>{s.label}</b> {s.done && <span className="sr-only">(done)</span>}
                <div className="muted small">{s.why}</div>
                {s.key === 'profile' && !s.done && data.profile_gaps.length > 0 && <div className="small">Missing: {data.profile_gaps.map((g) => g.label).join(', ')}</div>}
                {s.key === 'billing' && !s.done && data.billing_gaps.length > 0 && <div className="small">Missing: {data.billing_gaps.map((g) => g.label).join(', ')}</div>}
              </div>
              {state === 'next' && <Link className="btn primary" href={s.href}>Start</Link>}
              {state === 'todo' && <Link className="link small" href={s.href}>Open</Link>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * Warn-only note when a profile (or billing) detail is missing. Renders nothing when
 * complete or unknown, so it never gets in the way.
 */
export function SetupWarning({ side, kind, action }: { side: Side; kind: 'profile' | 'billing'; action: string }) {
  const data = useOnboarding(side);
  const gaps = kind === 'billing' ? data?.billing_gaps : data?.profile_gaps;
  if (!data || !data.applies || !gaps || !gaps.length) return null;
  const href = side === 'client' ? '/client/profile' : '/profile';
  const what = kind === 'billing' ? 'billing details' : side === 'client' ? 'client profile' : 'profile';
  return (
    <div className="setup-warning" role="note" data-testid={`setup-warning-${kind}`}>
      <b>Your {what} is not complete.</b> {kind === 'billing' ? 'Invoices need them.' : side === 'client' ? 'Freelancers trust complete profiles and reply sooner.' : 'Clients see that your profile is incomplete.'}
      {' '}Missing: {gaps.map((g) => g.label).join(', ')}. <Link className="link" href={href}>Complete it now</Link> — or {action}.
    </div>
  );
}
