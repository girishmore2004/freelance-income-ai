'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

/** What is missing from a freelancer's profile, ordered by how much it helps matching (U12). Hidden once complete. */

type Item = { key: string; label: string; done: boolean; why: string; href: string };
type Checklist = { applies: boolean; score: number; items: Item[] };

export function ProfileChecklist() {
  const [data, setData] = useState<Checklist | null>(null);
  useEffect(() => {
    api<Checklist>('/api/v1/me/profile-checklist')
      .then((r) => setData(r && Array.isArray(r.items) ? r : null))
      .catch(() => setData(null));
  }, []);
  if (!data || !data.applies || data.score >= 100) return null;
  const todo = data.items.filter((i) => !i.done);
  return (
    <section className="card" aria-label="Profile checklist">
      <div className="row between"><b>Get more matches</b><span className="muted">{data.score}% complete</span></div>
      <div className="bar" role="progressbar" aria-valuenow={data.score} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completeness"><span style={{ width: `${data.score}%` }} /></div>
      <ol>
        {todo.slice(0, 3).map((i) => (
          <li key={i.key}><a className="link" href={i.href}>{i.label}</a> <span className="muted small">— {i.why}</span></li>
        ))}
      </ol>
      {todo.length > 3 && <p className="muted small">{todo.length - 3} more after these.</p>}
    </section>
  );
}
