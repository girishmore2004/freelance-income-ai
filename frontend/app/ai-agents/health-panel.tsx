'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

/**
 * Agent health (Admin workspace): for every registry agent its status, use in
 * the last 7 days and a self-test on fixed examples with known answers. The
 * "Test the AI model" button makes one tiny model call (admins only).
 */
type Item = { code: string; name: string; status: string; enabled: boolean; runs_7d: number; failed_7d: number; last_run_at: string | null; self_test: { ok: boolean; detail: string } | null; verdict: string;
  /** P8 (U24): the agent's evaluation set. */
  evaluation?: { cases: number; passed: number; failed: string[] } | null };
type Health = {
  ai_provider: { configured: boolean; model: string; calls_7d: number; live_check: { ok: boolean; ms: number; detail: string } | null };
  items: Item[]; passed: number; total: number; note: string;
  evaluation?: { cases: number; passed: number; agents: number };
};

const VERDICT: Record<string, string> = { working: '✓ Working', failing: '✗ Failing', switched_off: 'Switched off', planned: 'Not built yet', blocked: 'Blocked (needs live payments)', no_test: 'Runs, no self-test' };

export function AgentHealthPanel() {
  const [data, setData] = useState<Health | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (live = false) => {
    setBusy(true);
    setError('');
    try {
      const h = await api<Health>(`/api/v1/admin/agents/health${live ? '?live=1' : ''}`);
      setData(h && Array.isArray(h.items) && h.ai_provider ? h : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not run the checks.');
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <section className="card" aria-labelledby="agent-health-heading">
      <div className="row between">
        <h3 id="agent-health-heading">Agent health</h3>
        <span className="row">
          <button className="btn" type="button" disabled={busy} onClick={() => void load()}>Run checks again</button>
          <button className="btn" type="button" disabled={busy} onClick={() => void load(true)}>Test the AI model</button>
        </span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {data && (
        <>
          <p>Self-tests passed: <b>{data.passed}/{data.total}</b>{data.evaluation && <> · Evaluation cases passed: <b>{data.evaluation.passed}/{data.evaluation.cases}</b> across {data.evaluation.agents} agents</>} · AI provider: {data.ai_provider.configured ? `connected (${data.ai_provider.model})` : 'not configured'} · AI calls in 7 days: {data.ai_provider.calls_7d}</p>
          {data.ai_provider.live_check && (
            <p className={data.ai_provider.live_check.ok ? 'success' : 'error'} role="status">Model test: {data.ai_provider.live_check.ok ? 'answered' : 'failed'} in {data.ai_provider.live_check.ms} ms. {data.ai_provider.live_check.detail}</p>
          )}
          <table>
            <caption className="sr-only">Agent health</caption>
            <thead><tr><th scope="col">Agent</th><th scope="col">State</th><th scope="col">Runs (7 days)</th><th scope="col">Evaluation</th><th scope="col">Self-test</th></tr></thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.code}>
                  <td>{a.code} · {a.name}</td>
                  <td className={a.verdict === 'failing' ? 'error' : a.verdict === 'working' ? 'success' : 'muted'}>{VERDICT[a.verdict] ?? a.verdict}</td>
                  <td>{a.runs_7d}{a.failed_7d ? ` (${a.failed_7d} failed)` : ''}</td>
                  <td className={a.evaluation && a.evaluation.failed.length ? 'error small' : 'small'}>{a.evaluation ? `${a.evaluation.passed}/${a.evaluation.cases}${a.evaluation.failed.length ? ` — failing: ${a.evaluation.failed.join('; ')}` : ''}` : '—'}</td>
                  <td className="small">{a.self_test ? a.self_test.detail : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">{data.note}</p>
        </>
      )}
    </section>
  );
}
