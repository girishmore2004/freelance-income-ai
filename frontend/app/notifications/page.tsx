'use client';
import { BackToWorkspace } from '../back-to-workspace';
import { NotificationSettings } from './settings';
import { useWorkspace } from '@/lib/mode';
import { useCallback, useEffect, useState } from 'react';
import { api, useSessionToken } from '@/lib/api-client';

/** In-app notifications inbox. */

type Item = { id: string; title: string; message: string; kind: string; link: string; read: boolean; created_at: string | null; side?: 'freelancer' | 'client' | null };

export default function NotificationsPage() {
  // Only the active side's notifications (account-wide ones show on both).
  // Freelancer and Client show their side plus account notices; Admin shows staff and account notices only.
  const mode = useWorkspace();
  const [token] = useSessionToken();
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const rows = await api<Item[]>('/api/v1/notifications');
      setItems(Array.isArray(rows) ? rows : []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load notifications.');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { if (token) void load(); }, [token, load]);

  async function markAll() {
    try {
      await api('/api/v1/notifications/read', 'POST', {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update.');
    }
  }

  async function open(item: Item) {
    if (!item.read) await api('/api/v1/notifications/read', 'POST', { ids: [item.id] }).catch(() => undefined);
    if (item.link && item.link.startsWith('/')) window.location.href = item.link;
    else await load();
  }

  if (!token) return <main className="shell"><div className="card"><h2>Notifications</h2><p className="muted">Sign in first to see your notifications.</p><a className="btn" href="/">Go to sign in</a></div></main>;

  const unread = items.filter((i) => !i.read).length;
  return (
    <main className="shell">
      <div className="row between">
        <h2>Notifications</h2>
        <span className="row">{unread > 0 && <button className="btn" onClick={() => void markAll()}>Mark all as read</button>}<BackToWorkspace /></span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {loaded && items.length === 0 && !error && <p className="empty">No notifications yet.</p>}
      <ul aria-label="Notifications">
        {items.filter((n) => (mode === 'admin' ? !n.side : !n.side || n.side === mode)).map((n) => (
          <li key={n.id} className="card item">
            <button className="link" onClick={() => void open(n)}><b>{n.read ? '' : '● '}{n.title}</b></button>
            <p className="muted">{n.message}{n.created_at ? ` · ${new Date(n.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : ''}</p>
          </li>
        ))}
      </ul>
      <NotificationSettings />
    </main>
  );
}
