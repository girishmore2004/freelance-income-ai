'use client';
import { useState } from 'react';
import { api } from '@/lib/api-client';

/**
 * F3 Profile and Portfolio Coach (U24): checks the saved profile for strong
 * claims without evidence, skills no project shows and thin portfolio
 * entries. Advice only; nothing on the profile changes.
 */
type Review = {
  score: number;
  items: Array<{ severity: 'warn' | 'info'; field: string; message: string }>;
  projects: Array<{ index: number; title: string; issues: string[] }>;
  skills_without_evidence: string[];
  note: string;
};

export function ProfileReview() {
  const [data, setData] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run() {
    setBusy(true);
    setError('');
    try {
      const r = await api<Review>('/api/v1/me/profile-review');
      setData(r && Array.isArray(r.items) ? r : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not review the profile.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="review-heading">
      <div className="row between">
        <h3 id="review-heading">Profile review</h3>
        <button className="btn" type="button" disabled={busy} onClick={() => void run()}>{data ? 'Review again' : 'Review my profile'}</button>
      </div>
      <p className="muted small">Checks your saved profile for claims clients cannot verify and for portfolio entries that need more detail. Save your changes first.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {data && (
        <div aria-live="polite">
          <p><b>Profile strength: {data.score} / 100</b></p>
          {data.items.length === 0 ? <p className="success">Nothing to improve right now.</p> : (
            <ul>{data.items.map((i, n) => <li key={`${i.field}-${n}`}><span className={i.severity === 'warn' ? 'badge danger' : 'badge'}>{i.severity === 'warn' ? 'Fix' : 'Tip'}</span> {i.message}</li>)}</ul>
          )}
          {data.projects.length > 0 && (
            <>
              <h4>Portfolio projects</h4>
              <ul>{data.projects.map((p) => <li key={p.index}><b>{p.title || `Project ${p.index + 1}`}</b>: {p.issues.join(' ')}</li>)}</ul>
            </>
          )}
          <p className="muted small">{data.note}</p>
        </div>
      )}
    </section>
  );
}
