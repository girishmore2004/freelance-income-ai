'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

/**
 * P9 Notification Orchestrator (U24): switch notification groups on or off.
 * Account, safety and dispute notices are always delivered. Email follows
 * once the email sender is set up (D-15), so it is described, not offered.
 */
type Group = { key: string; label: string; mutable: boolean; in_app: boolean };
type Settings = { available: boolean; groups: Group[]; email: { available: boolean; note: string } };

export function NotificationSettings() {
  const [data, setData] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api<Settings>('/api/v1/me/notification-settings').then((s) => setData(s && Array.isArray(s.groups) ? s : null)).catch(() => setData(null));
  }, []);

  async function toggle(g: Group) {
    setBusy(true);
    setNotice('');
    setError('');
    try {
      const s = await api<Settings>('/api/v1/me/notification-settings', 'PUT', { groups: { [g.key]: !g.in_app } });
      if (s && Array.isArray(s.groups)) setData(s);
      setNotice(`${g.label}: ${g.in_app ? 'off' : 'on'}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;
  return (
    <section className="card" aria-labelledby="notif-settings-heading">
      <h3 id="notif-settings-heading">Notification settings</h3>
      {!data.available && <p className="notice small">Settings can be saved after the next database update.</p>}
      <ul>
        {data.groups.map((g) => (
          <li key={g.key} className="row between">
            <span>{g.label}</span>
            {g.mutable
              ? <label className="row"><input type="checkbox" aria-label={g.label} checked={g.in_app} disabled={busy || !data.available} onChange={() => void toggle(g)} /> <span>{g.in_app ? 'On' : 'Off'}</span></label>
              : <span className="muted small">Always on</span>}
          </li>
        ))}
      </ul>
      <p className="muted small">{data.email.note}</p>
      <div aria-live="polite">{notice && <p className="success small">{notice}</p>}{error && <p className="error small" role="alert">{error}</p>}</div>
    </section>
  );
}
