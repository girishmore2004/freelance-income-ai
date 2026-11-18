'use client';
import { useState } from 'react';
import { api } from '@/lib/api-client';

/**
 * C4 Interview Preparation agent: questions to ask a freelancer, each with
 * the reason it came up (uncovered deliverables, missing skills, price or
 * timeline gaps, their assumptions and questions). Rules only; nothing is sent.
 */
type Prep = { questions: Array<{ topic: string; question: string; why: string }>; note: string };

export function InterviewPrep({ proposalId }: { proposalId: string }) {
  const [prep, setPrep] = useState<Prep | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (prep) return;
    try {
      setPrep(await api<Prep>(`/api/v1/listing-proposals/${proposalId}/interview-prep`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not prepare questions.');
    }
  }

  return (
    <>
      <button className="link" type="button" aria-expanded={open} onClick={() => void toggle()}>{open ? 'Hide interview questions' : 'Interview questions'}</button>
      {open && (
        <div className="card item" aria-label="Interview questions" role="region">
          {error && <p className="error" role="alert">{error}</p>}
          {!prep && !error && <p className="muted">Preparing…</p>}
          {prep && prep.questions.length === 0 && <p className="muted">Nothing stands out: the proposal covers the brief. Ask about working style and availability.</p>}
          {prep && prep.questions.length > 0 && (
            <ol>{prep.questions.map((q, i) => <li key={i}><span className="badge">{q.topic}</span> {q.question}<br /><span className="muted small">{q.why}</span></li>)}</ol>
          )}
          {prep && <p className="muted small">{prep.note}</p>}
        </div>
      )}
    </>
  );
}
