'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, useSessionToken } from '@/lib/api-client';
import { THREAD_KIND_LABELS, inboxThreads, needsReplyCount, type InboxThread } from '@/lib/discussion';
import { DiscussionPanel } from './discussion-panel';

/**
 * One inbox for every conversation (U9, spec §9): proposal discussions before
 * an offer, contract messages, and replies recorded on external applications.
 * Proposal threads open here; contract and external threads open on their
 * own pages, where the work lives.
 */

export default function InboxPage() {
  const [token] = useSessionToken();
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'waiting'>('all');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (query = '') => {
    try {
      setThreads(inboxThreads(await api<InboxThread[]>(`/api/v1/inbox${query ? `?q=${encodeURIComponent(query)}` : ''}`)));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your inbox.');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    void load();
    const proposal = new URLSearchParams(window.location.search).get('proposal');
    if (proposal && /^[\w-]{1,64}$/.test(proposal)) setOpen(proposal);
  }, [token, load]);

  function search(e: FormEvent) {
    e.preventDefault();
    void load(q.trim());
  }

  if (!token) return <main className="shell"><div className="card"><h2>Inbox</h2><p className="muted">Sign in first to see your messages.</p><a className="btn" href="/">Go to sign in</a></div></main>;

  const waiting = needsReplyCount(threads);
  const shown = filter === 'waiting' ? threads.filter((t) => t.from_other_side) : threads;
  return (
    <main className="shell">
      <h2>Inbox</h2>
      <p className="muted">Messages about proposals, contracts and your external applications in one place.</p>
      <form className="row" onSubmit={search} role="search">
        <label htmlFor="inbox-q" className="sr-only">Search messages</label>
        <input id="inbox-q" placeholder="Search by project or message" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} />
        <button className="btn" type="submit">Search</button>
        <span role="group" aria-label="Show" className="row">
          <button className="btn" type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All ({threads.length})</button>
          <button className="btn" type="button" aria-pressed={filter === 'waiting'} onClick={() => setFilter('waiting')}>Waiting for you ({waiting})</button>
        </span>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {loaded && shown.length === 0 && !error && (
        <p className="empty">{filter === 'waiting' ? 'Nothing is waiting for your reply.' : 'No conversations yet. Messages start when you discuss a proposal, sign a contract or record a reply on an application.'}</p>
      )}
      <ul aria-label="Conversations">
        {shown.map((t) => (
          <li key={`${t.kind}:${t.id}`} className="card item">
            <div className="row between">
              <span><span className="badge">{THREAD_KIND_LABELS[t.kind]}</span> <b>{t.title}</b>{t.from_other_side && <span className="badge"> Waiting for you</span>}</span>
              <span className="muted">{new Date(t.last_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
            </div>
            <p className="muted">{t.last_message}</p>
            {t.kind === 'proposal'
              ? <button className="link" type="button" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? 'Close conversation' : 'Open conversation'}</button>
              : <a className="link" href={t.href.startsWith('/') ? t.href : '/'}>{t.kind === 'contract' ? 'Open contract' : 'Open application'}</a>}
            {open === t.id && t.kind === 'proposal' && <DiscussionPanel proposalId={t.id} />}
          </li>
        ))}
      </ul>
      {open && !threads.some((t) => t.kind === 'proposal' && t.id === open) && loaded && (
        <section aria-label="Opened conversation"><h3>Conversation</h3><DiscussionPanel proposalId={open} /></section>
      )}
    </main>
  );
}
