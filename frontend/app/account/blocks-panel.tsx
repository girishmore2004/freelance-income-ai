'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

/** The people and client accounts you blocked, with Unblock (U23). */
type Block = { id: string; side: 'freelancer' | 'client'; name: string; for_account: string | null; reason: string; created_at: string };

export function BlocksPanel() {
  const [items, setItems] = useState<Block[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const rows = await api<Block[]>('/api/v1/me/blocks');
      setItems(Array.isArray(rows) ? rows : []);
    } catch {
      setItems(null);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function unblock(b: Block) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/v1/blocks/${b.id}/remove`, 'POST', {});
      setNotice(`Unblocked ${b.name}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not unblock.');
    } finally {
      setBusy(false);
    }
  }

  if (items === null) return null;
  return (
    <section className="card" aria-labelledby="blocks-heading">
      <h3 id="blocks-heading">Blocked</h3>
      <div aria-live="polite">{notice && <p className="success small">{notice}</p>}{error && <p className="error small" role="alert">{error}</p>}</div>
      {items.length === 0 ? (
        <p className="empty">You have not blocked anyone. Use “Block this client” on a project or “Block this freelancer” on a proposal.</p>
      ) : (
        <ul>
          {items.map((b) => (
            <li key={b.id} className="row between">
              <span>
                <b>{b.name}</b> <span className="muted small">{b.side === 'freelancer' ? 'client account you blocked as a freelancer' : `freelancer blocked for ${b.for_account ?? 'your client account'}`} · {new Date(b.created_at).toLocaleDateString()}{b.reason ? ` · ${b.reason}` : ''}</span>
              </span>
              <button className="btn" type="button" disabled={busy} onClick={() => void unblock(b)}>Unblock {b.name}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
