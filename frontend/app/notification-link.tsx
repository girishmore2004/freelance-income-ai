'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

/** "Notifications (n)" link for page headers; polls gently while the page is open. */
export function NotificationLink() {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let stop = false;
    const tick = () => api<{ unread: number }>('/api/v1/notifications/unread-count')
      .then((r) => { if (!stop && r && typeof r.unread === 'number') setUnread(r.unread); })
      .catch(() => undefined);
    void tick();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void tick(); }, 60_000);
    return () => { stop = true; clearInterval(timer); };
  }, []);
  return <a className="link" href="/notifications">Notifications{unread > 0 ? ` (${unread})` : ''}</a>;
}
