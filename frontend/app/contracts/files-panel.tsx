'use client';
import { useState, type ChangeEvent } from 'react';
import { API_BASE, ApiError, api, authFetch } from '@/lib/api-client';

/**
 * Contract files (stored in R2 by the Edge API). Uploads are checked on the
 * server (type from the bytes, 10 MB, per-contract limits); downloads always
 * save as a file and never open inside the app.
 */

export type ContractFile = { id: string; filename: string; content_type: string; size_bytes: number; party: string; attached: boolean; mine: boolean; created_at: string };
export type FilesState = { files: ContractFile[]; uploads_enabled: boolean; max_bytes: number; allowed: string[] };

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Downloads with the session (cookie or bearer) and saves under the original name. */
export async function downloadFile(id: string, filename: string): Promise<void> {
  const response = await authFetch(`${API_BASE}/api/v1/files/${encodeURIComponent(id)}`);
  if (!response.ok) {
    let message = 'Could not download the file.';
    try {
      const body = (await response.json()) as { message?: string };
      if (typeof body.message === 'string') message = body.message;
    } catch {
      // Not JSON: keep the generic message.
    }
    throw new ApiError(message, response.status, null);
  }
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FileLink({ file, onError }: { file: { id: string; filename: string; size_bytes: number }; onError: (message: string) => void }) {
  return (
    <button className="link" type="button" onClick={() => void downloadFile(file.id, file.filename).catch((e: unknown) => onError(e instanceof Error ? e.message : 'Could not download the file.'))}>
      {file.filename} ({formatBytes(file.size_bytes)})
    </button>
  );
}

export function FilesPanel({ contractId, state, canUpload, onChanged, onError }: { contractId: string; state: FilesState; canUpload: boolean; onChanged: () => Promise<void>; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setNotice('');
    if (file.size > state.max_bytes) {
      onError(`Files can be up to ${formatBytes(state.max_bytes)}.`);
      input.value = '';
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await api(`/api/v1/contracts/${contractId}/files`, 'POST', form);
      setNotice(`${file.name} uploaded`);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
      input.value = '';
    }
  }

  async function remove(file: ContractFile) {
    setBusy(true);
    try {
      await api(`/api/v1/files/${file.id}/delete`, 'POST', {});
      setNotice(`${file.filename} deleted`);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not delete the file.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div aria-label="Files">
      <b>Files</b>
      {notice && <p className="success" aria-live="polite">{notice}</p>}
      {state.files.length === 0 && <p className="empty">No files yet.</p>}
      <ul>
        {state.files.map((f) => (
          <li key={f.id}>
            <FileLink file={f} onError={onError} /> <span className="muted">{f.party === 'client' ? 'client' : 'freelancer'}{f.attached ? ' · in a delivery' : ''}</span>
            {f.mine && !f.attached && <> <button className="link" type="button" disabled={busy} onClick={() => void remove(f)}>Delete</button></>}
          </li>
        ))}
      </ul>
      {canUpload && state.uploads_enabled && (
        <div className="field">
          <label htmlFor={`upload-${contractId}`}>Add a file (up to {formatBytes(state.max_bytes)}: {state.allowed.join(', ')})</label>
          <input id={`upload-${contractId}`} type="file" disabled={busy} accept={state.allowed.map((e) => `.${e}`).join(',')} onChange={(e) => void upload(e)} />
        </div>
      )}
      {canUpload && !state.uploads_enabled && <p className="muted">File uploads are not switched on yet. Share links in the delivery note for now.</p>}
    </div>
  );
}
