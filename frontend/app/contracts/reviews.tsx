'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api-client';

/**
 * Two-way review after completion. The other party's review is hidden until
 * both reviewed (or 14 days passed), so neither side can retaliate.
 */

type Review = { party: string; rating: number; comment: string; created_at: string };
type Reviews = { party: string; can_review: boolean; revealed: boolean; mine: Review | null; theirs: Review | null; theirs_submitted: boolean };

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

export function ContractReviews({ contractId }: { contractId: string }) {
  const [data, setData] = useState<Reviews | null>(null);
  const [rating, setRating] = useState('5');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await api<Reviews>(`/api/v1/contracts/${contractId}/reviews`);
      if (result && typeof result.revealed === 'boolean') setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load reviews.');
    }
  }, [contractId]);

  useEffect(() => { void load(); }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<Reviews & { message?: string }>(`/api/v1/contracts/${contractId}/review`, 'POST', { rating: Number(rating), comment });
      setNotice(result.message ?? 'Review saved');
      setData(result);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the review.');
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <p className="error" role="alert">{error}</p> : null;
  const other = data.party === 'client' ? 'freelancer' : 'client';
  return (
    <section className="card" aria-label="Reviews">
      <b>Reviews</b>
      <div aria-live="polite">
        {notice && <p className="success">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      {data.mine && <p>Your review: <span aria-label={`${data.mine.rating} out of 5`}>{stars(data.mine.rating)}</span> {data.mine.comment}</p>}
      {data.theirs
        ? <p>The {other}’s review: <span aria-label={`${data.theirs.rating} out of 5`}>{stars(data.theirs.rating)}</span> {data.theirs.comment}</p>
        : <p className="muted">{data.theirs_submitted ? `The ${other} has reviewed you. It will be shown after you review, or after 14 days.` : `The ${other} has not reviewed yet.`}</p>}
      {data.can_review && (
        <form onSubmit={(e) => void submit(e)}>
          <div className="row">
            <div className="field">
              <label htmlFor={`rating-${contractId}`}>Rating</label>
              <select id={`rating-${contractId}`} value={rating} onChange={(e) => setRating(e.target.value)}>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} – {stars(n)}</option>)}
              </select>
            </div>
          </div>
          <div className="field"><label htmlFor={`comment-${contractId}`}>Comment (optional)</label><textarea id={`comment-${contractId}`} rows={3} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} /></div>
          <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Submit review'}</button>
        </form>
      )}
    </section>
  );
}
