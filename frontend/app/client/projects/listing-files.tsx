'use client';
import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { downloadFrom, formatBytes } from '../../contracts/files-panel';

/**
 * Reference files on a project brief (U10, posting step 7). Owners and admins
 * add or remove them; freelancers who can see the project download them.
 * `mode` picks the API: `client` = the organisation's own view, `freelancer` = marketplace view.
 */

type ListingFile = { id: string; filename: string; content_type: string; size_bytes: number; mine: boolean; created_at: string };
type State = { files: ListingFile[]; uploads_enabled: boolean; can_manage?: boolean; max_bytes: number; allowed: string[] };

function isState(v: unknown): v is State {
  return Boolean(v) && typeof v === 'object' && Array.isArray((v as State).files);
}

export function ListingFiles({ listingId, mode, closed = false }: { listingId: string; mode: 'client' | 'freelancer'; closed?: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const base = mode === 'client' ? `/api/v1/listings/${listingId}/files` : `/api/v1/marketplace/listings/${listingId}/files`;

  const load = useCallback(async () => {
    try {
      const result = await api<State>(base);
      setState(isState(result) ? result : null);
    } catch (e) {
      if (!(e instanceof ApiError && (e.code === 'FEATURE_DISABLED' || e.status === 404))) setError(e instanceof Error ? e.message : 'Could not load files.');
    }
  }, [base]);

  useEffect(() => { void load(); }, [load]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || !state) return;
    setError('');
    setNotice('');
    if (file.size > state.max_bytes) { setError(`Files can be up to ${formatBytes(state.max_bytes)}.`); input.value = ''; return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await api(base, 'POST', form);
      setNotice(`${file.name} added`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
      input.value = '';
    }
  }

  async function remove(f: ListingFile) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/v1/listing-files/${f.id}/delete`, 'POST', {});
      setNotice(`${f.filename} removed`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the file.');
    } finally {
      setBusy(false);
    }
  }

  if (!state || (mode === 'freelancer' && state.files.length === 0 && !error)) return null;
  const manage = mode === 'client' && Boolean(state.can_manage);
  return (
    <div className="card" aria-label="Project files">
      <b>Project files</b>
      <div aria-live="polite">
        {notice && <p className="success">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      {state.files.length === 0 && <p className="muted">No reference files. Add mock-ups, examples or a written spec (up to 10 files).</p>}
      <ul>
        {state.files.map((f) => (
          <li key={f.id}>
            <button className="link" type="button" onClick={() => void downloadFrom(`/api/v1/listing-files/${encodeURIComponent(f.id)}`, f.filename).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not download the file.'))}>
              {f.filename} ({formatBytes(f.size_bytes)})
            </button>
            {manage && <> <button className="link" type="button" disabled={busy} onClick={() => void remove(f)}>Remove</button></>}
          </li>
        ))}
      </ul>
      {manage && !closed && state.uploads_enabled && (
        <div className="field">
          <label htmlFor={`listing-upload-${listingId}`}>Add a reference file (up to {formatBytes(state.max_bytes)}: {state.allowed.join(', ')})</label>
          <input id={`listing-upload-${listingId}`} type="file" disabled={busy} accept={state.allowed.map((e) => `.${e}`).join(',')} onChange={(e) => void upload(e)} />
        </div>
      )}
      {manage && !state.uploads_enabled && <p className="muted">File uploads are not switched on yet. Put links in the brief for now.</p>}
      {mode === 'freelancer' && <p className="muted">Files come from the client. Open Office and ZIP files with care.</p>}
    </div>
  );
}
