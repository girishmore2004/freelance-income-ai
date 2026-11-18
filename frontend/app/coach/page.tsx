'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, useSessionToken } from '@/lib/api-client';

/** F11 Business Coach: answers only from your own records, with citations; advice only. */

type Source = { id: string; type: string; excerpt: string };
type Turn = { id: string; question: string; answer: string; sources: Source[]; generation_mode: string; created_at: string; citation_validation?: { valid: string[]; unknown: string[] } };

export default function CoachPage() {
  const [token] = useSessionToken();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const rows = await api<Turn[]>('/api/v1/coach/history');
      setTurns(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the history.');
    }
  }, []);

  useEffect(() => { if (token) void load(); }, [token, load]);

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<Turn>('/api/v1/coach/ask', 'POST', { question });
      if (result && typeof result.answer === 'string') setTurns((old) => [result, ...old]);
      setQuestion('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The coach could not answer.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <main className="shell"><p>Sign in first, then open the business coach.</p><a className="btn" href="/">Back to dashboard</a></main>;
  return (
    <main className="shell">
      <header className="top">
        <div><div className="brand">AI business coach</div><div className="muted">Ask about your own profile, goals, proposals, contracts and earnings</div></div>
        <nav className="row"><a className="btn" href="/agent">Action plan</a><a className="btn" href="/workspace">Workspace</a><a className="btn" href="/">Dashboard</a></nav>
      </header>
      <section className="card">
        <p className="muted">The coach only sees records from your account and must cite them. If it cannot use the AI model, it tells you which records it found instead of guessing. Advice only — it never sends, submits or pays anything.</p>
        <form onSubmit={(e) => void ask(e)}>
          <div className="field">
            <label htmlFor="coach-question">Your question</label>
            <textarea id="coach-question" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={2000} placeholder="Which contract needs my attention first?" />
          </div>
          <button className="btn primary" disabled={busy || !question.trim()}>{busy ? 'Thinking…' : 'Ask the coach'}</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      <section className="card">
        <h2>Conversation</h2>
        {turns.length === 0 ? <p className="empty">No questions yet.</p> : turns.map((t) => (
          <article className="item" key={t.id}>
            <small className="muted">{new Date(t.created_at).toLocaleString()} · {t.generation_mode === 'llm_grounded_context' ? 'AI answer from your records' : 'No AI conclusion (records listed)'}</small>
            <h3>{t.question}</h3>
            <p style={{ whiteSpace: 'pre-wrap' }}>{t.answer}</p>
            {t.citation_validation && t.citation_validation.unknown.length > 0 && <p className="muted">Some citations did not match your records: {t.citation_validation.unknown.join(', ')}. Treat those statements with care.</p>}
            <details><summary>Records used ({t.sources?.length ?? 0})</summary>{(t.sources ?? []).map((s) => <p className="muted" key={s.id}><b>{s.type}</b> · {s.id}<br />{s.excerpt}</p>)}</details>
          </article>
        ))}
      </section>
    </main>
  );
}
