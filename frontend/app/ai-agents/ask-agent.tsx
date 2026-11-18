'use client';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api-client';

/**
 * Ask about one agent (U15): the Business Coach (F11) answers from your own
 * records plus this agent's description and your recent runs of it, with
 * citations. It never acts: answers suggest steps you take yourself.
 */

type Answer = { answer: string; generation_mode: string; sources: Array<{ id: string; type: string; excerpt: string }>; citation_validation?: { valid: string[] } };

export function AskAgent({ code, name }: { code: string; name: string }) {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<Answer | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function ask(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<Answer>('/api/v1/coach/ask', 'POST', { question: question.trim(), agent: code });
      setResult(r && typeof r.answer === 'string' ? r : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not get an answer.');
    } finally {
      setBusy(false);
    }
  }

  const cited = new Set(result?.citation_validation?.valid ?? []);
  return (
    <form onSubmit={ask} aria-label={`Ask about ${name}`}>
      <div className="field">
        <label htmlFor={`ask-${code}`}>Ask about {name}</label>
        <input id={`ask-${code}`} maxLength={2000} value={question} placeholder="e.g. Why were my last searches empty?" onChange={(e) => setQuestion(e.target.value)} />
      </div>
      <button className="btn" type="submit" disabled={busy || question.trim().length < 3}>Ask</button>
      {error && <p className="error" role="alert">{error}</p>}
      {result && (
        <div className="card" aria-live="polite">
          <p style={{ whiteSpace: 'pre-wrap' }}>{result.answer}</p>
          <p className="muted small">{result.generation_mode === 'llm_grounded_context' ? 'AI answer from your records' : 'No AI used: the records found are listed'} · it never takes action for you.</p>
          {result.sources.length > 0 && (
            <details>
              <summary>Records used ({result.sources.length})</summary>
              <ul>{result.sources.slice(0, 20).map((s) => <li key={s.id} className="small">{cited.has(s.id) ? '✓ ' : ''}<code>{s.id}</code> {s.excerpt}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </form>
  );
}
