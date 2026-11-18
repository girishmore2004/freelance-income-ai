'use client';
import { useState } from 'react';
import { api } from '@/lib/api-client';
import { linesToList } from '@/lib/listing-format';

/**
 * F8 Delivery QA agent: before delivering, checks the note and links against
 * the contract's acceptance criteria and deliverables (word match, no model)
 * and lists what to add. The freelancer still decides when to deliver.
 */
type Result = {
  items: Array<{ criterion: string; mentioned: boolean }>; deliverables: Array<{ deliverable: string; mentioned: boolean }>;
  tips: string[]; ready: boolean; summary: string; note: string;
};

export function DeliveryCheck({ contractId, index, note, links }: { contractId: string; index: number; note: string; links: string }) {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError('');
    try {
      setResult(await api<Result>(`/api/v1/contracts/${contractId}/milestones/${index}/precheck`, 'POST', { note, links: linesToList(links) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check the delivery.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div aria-label="Delivery check" role="group">
      <button className="btn" type="button" disabled={busy} onClick={() => void run()}>{busy ? 'Checking…' : 'Check before sending'}</button>
      {error && <p className="error" role="alert">{error}</p>}
      {result && (
        <div className="card item">
          <p><b>{result.ready ? 'Looks complete.' : 'Before you send:'}</b> {result.summary}</p>
          <ul className="small">
            {result.items.map((i) => <li key={i.criterion}>{i.mentioned ? '✓' : '✗'} {i.criterion}</li>)}
            {result.deliverables.map((d) => <li key={d.deliverable}>{d.mentioned ? '✓' : '✗'} Deliverable: {d.deliverable}</li>)}
          </ul>
          {result.tips.length > 0 && <ul className="small">{result.tips.map((t) => <li key={t}>{t}</li>)}</ul>}
          <p className="muted small">{result.note}</p>
        </div>
      )}
    </div>
  );
}
