
'use client';

import { useEffect, useState, type FormEvent } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type Client = {
  id: string;
  name: string;
  company: string;
  email: string | null;
  phone: string;
  website: string;
  notes: string;
  tags: string[];
  status: string;
};

type Project = {
  id: string;
  title: string;
  client_id: string | null;
  client_name: string;
  budget: number;
  currency: string;
  due_date: string;
  status: string;
};

type Change = {
  id: string;
  project_id: string;
  title: string;
  description: string;
  reason: string;
  budget_delta: number;
  currency: string;
  timeline_delta_days: number;
  status: string;
  request_hash: string;
  decision_note: string;
  client_accepted: boolean;
  client_accepted_at: string | null;
};

type Activity = {
  type: string;
  id: string;
  title: string;
  detail: string;
  occurred_at: string;
};

type Contract = {
  id: string;
  client_id: string;
  project_id: string | null;
  title: string;
  contract_type: string;
  version: number;
  content: string;
  content_hash: string;
  status: string;
  currency: string;
  value: number;
  expires_on: string;
  decision_note: string;
};

type ContractRevision = {
  version: number;
  title: string;
  content: string;
  content_hash: string;
  previous_hash: string;
  created_at: string;
};

export default function ClientsPage() {
  const [token, setToken] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [profitability, setProfitability] = useState<Record<string, unknown>>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);

  const [form, setForm] = useState({
    name: '',
    company: '',
    email: '',
    phone: '',
    website: '',
    notes: '',
    tags: '',
  });

  const [editingClientId, setEditingClientId] = useState('');

  const [scope, setScope] = useState({
    project_id: '',
    title: '',
    description: '',
    reason: '',
    budget_delta: 0,
    currency: 'INR',
    timeline_delta_days: 0,
  });

  const [contractForm, setContractForm] = useState({
    client_id: '',
    project_id: '',
    title: '',
    contract_type: 'statement_of_work',
    content: '',
    currency: 'INR',
    value: 0,
    expires_on: '',
  });

  const [communicationForm, setCommunicationForm] = useState({
    client_id: '',
    project_id: '',
    channel: 'note',
    direction: 'internal',
    subject: '',
    body: '',
  });

  const [accept, setAccept] = useState<Record<string, boolean>>({});
  const [evidenceNote, setEvidenceNote] = useState<Record<string, string>>({});
  const [activity, setActivity] = useState<Record<string, Activity[]>>({});
  const [contractRevisions, setContractRevisions] = useState<
    Record<string, ContractRevision[]>
  >({});

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function req(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    const data = await response.json().catch(() => ({
      detail: 'Invalid server response',
    }));

    if (!response.ok) {
      throw new Error(
        typeof data.detail === 'string' ? data.detail : 'Request failed'
      );
    }

    return data;
  }

  async function load() {
    if (!token) return;

    setBusy(true);
    setError('');

    try {
      const [clientRows, projectRows, changeRows, contractRows] =
        await Promise.all([
          req('/api/v1/clients'),
          req('/api/v1/projects'),
          req('/api/v1/scope-changes'),
          req('/api/v1/client-contracts'),
        ]);

      setClients(clientRows);
      setProjects(projectRows);
      setChanges(changeRows);
      setContracts(contractRows);

      if (!scope.project_id && projectRows.length) {
        setScope((value) => ({
          ...value,
          project_id: projectRows[0].id,
          currency: projectRows[0].currency || 'INR',
        }));
      }
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : 'Unable to load CRM data'
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const saved = localStorage.getItem('fia_token') || '';
    setToken(saved);
  }, []);

  useEffect(() => {
    if (token) void load();
  }, [token]);

  async function createClient(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const payload = {
        ...form,
        email: form.email || null,
        tags: form.tags
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      };

      await req(
        editingClientId
          ? `/api/v1/clients/${editingClientId}`
          : '/api/v1/clients',
        editingClientId ? 'PATCH' : 'POST',
        payload
      );

      setForm({
        name: '',
        company: '',
        email: '',
        phone: '',
        website: '',
        notes: '',
        tags: '',
      });

      setEditingClientId('');
      setMessage('Client saved.');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unable to save client');
    } finally {
      setBusy(false);
    }
  }

  async function linkClient(projectId: string, clientId: string) {
    if (!clientId) return;

    setBusy(true);

    try {
      await req(`/api/v1/projects/${projectId}/client`, 'PUT', {
        client_id: clientId,
      });

      setMessage('Client linked to project.');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unable to link client');
    } finally {
      setBusy(false);
    }
  }

  async function createScope(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const row = await req(
        `/api/v1/projects/${scope.project_id}/scope-changes`,
        'POST',
        {
          title: scope.title,
          description: scope.description,
          reason: scope.reason,
          budget_delta: Number(scope.budget_delta),
          currency: scope.currency,
          timeline_delta_days: Number(scope.timeline_delta_days),
        }
      );

      await req(
        `/api/v1/scope-changes/${row.id}/request-approval`,
        'POST'
      );

      setScope((value) => ({
        ...value,
        title: '',
        description: '',
        reason: '',
        budget_delta: 0,
        timeline_delta_days: 0,
      }));

      setMessage('Scope change submitted for review.');
      await load();
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : 'Unable to submit scope change'
      );
    } finally {
      setBusy(false);
    }
  }

  async function decide(
    row: Change,
    decision: 'approved' | 'rejected'
  ) {
    setBusy(true);
    setError('');
    setMessage('');

    try {
      await req(`/api/v1/scope-changes/${row.id}/decision`, 'POST', {
        decision,
        request_hash: row.request_hash,
        client_accepted: decision === 'approved' && !!accept[row.id],
        note:
          decision === 'approved'
            ? evidenceNote[row.id]
            : 'Rejected by account owner.',
      });

      setMessage(`Scope change ${decision}.`);
      await load();
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : 'Unable to decide scope change'
      );
    } finally {
      setBusy(false);
    }
  }

  async function editClient(client: Client) {
    setEditingClientId(client.id);

    setForm({
      name: client.name,
      company: client.company,
      email: client.email || '',
      phone: client.phone,
      website: client.website,
      notes: client.notes,
      tags: client.tags.join(', '),
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function requestScopeApproval(id: string) {
    setBusy(true);
    setError('');

    try {
      await req(`/api/v1/scope-changes/${id}/request-approval`, 'POST');

      setMessage('Scope change submitted for approval.');
      await load();
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : 'Unable to submit scope change'
      );
    } finally {
      setBusy(false);
    }
  }

  async function showActivity(clientId: string) {
    setError('');

    try {
      const result = await req(`/api/v1/clients/${clientId}/activity`);

      setActivity((value) => ({
        ...value,
        [clientId]: result.events || [],
      }));
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : 'Unable to load client history'
      );
    }
  }

  async function saveContract(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');

    try {
      await req('/api/v1/client-contracts', 'POST', {
        ...contractForm,
        project_id: contractForm.project_id || null,
        value: Number(contractForm.value),
      });

      setContractForm((value) => ({
        ...value,
        title: '',
        content: '',
        value: 0,
        expires_on: '',
      }));

      setMessage(
        'Contract/SOW draft saved. It has not been sent to the client.'
      );

      await load();
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : 'Unable to save contract'
      );
    } finally {
      setBusy(false);
    }
  }

  async function showContractRevisions(contractId: string) {
    setError('');

    try {
      const result = await req(
        `/api/v1/client-contracts/${contractId}/revisions`
      );

      setContractRevisions((value) => ({
        ...value,
        [contractId]: result.revisions || [],
      }));

      setMessage(
        `Contract revision chain integrity: ${
          result.chain_valid ? 'verified' : 'WARNING — chain mismatch'
        }.`
      );
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : 'Unable to load contract revisions'
      );
    }
  }

  async function createContractRevision(row: Contract) {
    const title = window.prompt('Revision title', row.title);
    if (title === null) return;

    const content = window.prompt(
      'Enter the complete revised contract/SOW text',
      row.content
    );
    if (content === null) return;

    const changeNote = window.prompt(
      'Describe what changed (required)',
      'Updated scope or terms'
    );
    if (changeNote === null) return;

    if (content.trim().length < 30 || changeNote.trim().length < 3) {
      setError(
        'Contract text must contain at least 30 characters and change note at least 3.'
      );
      return;
    }

    setBusy(true);
    setError('');

    try {
      await req(
        `/api/v1/client-contracts/${row.id}/revisions`,
        'POST',
        {
          title,
          content,
          contract_type: row.contract_type,
          currency: row.currency,
          value: row.value,
          expires_on: row.expires_on,
          change_note: changeNote,
        }
      );

      setMessage(
        'New contract revision saved as a draft. Previous snapshots are retained; it has not been sent.'
      );

      await load();
      await showContractRevisions(row.id);
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : 'Unable to create contract revision'
      );
    } finally {
      setBusy(false);
    }
  }

  async function contractDecision(
    row: Contract,
    decision: 'sent' | 'accepted' | 'rejected' | 'archived'
  ) {
    setBusy(true);
    setError('');

    try {
      const evidence =
        decision === 'accepted'
          ? window.prompt(
              'Enter the client written-acceptance evidence reference (date, email/thread or signed document reference):'
            ) || ''
          : '';

      if (decision === 'accepted' && evidence.trim().length < 10) {
        throw new Error(
          'Acceptance evidence of at least 10 characters is required'
        );
      }

      await req(
        `/api/v1/client-contracts/${row.id}/decision`,
        'POST',
        {
          decision,
          content_hash: row.content_hash,
          note: 'Updated by account owner',
          client_acceptance_evidence: evidence,
        }
      );

      setMessage(`Contract status recorded: ${decision}.`);
      await load();
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : 'Unable to update contract'
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveCommunication(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');

    try {
      await req('/api/v1/client-communications', 'POST', {
        ...communicationForm,
        project_id: communicationForm.project_id || null,
      });

      setCommunicationForm((value) => ({
        ...value,
        subject: '',
        body: '',
      }));

      setMessage('Communication timeline entry saved.');
      await showActivity(communicationForm.client_id);
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : 'Unable to save communication'
      );
    } finally {
      setBusy(false);
    }
  }

  async function showProfitability(clientId: string) {
    setError('');

    try {
      const result = await req(
        `/api/v1/clients/${clientId}/profitability`
      );

      setProfitability((value) => ({
        ...value,
        [clientId]: result,
      }));
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : 'Unable to load profitability'
      );
    }
  }

  if (!token) {
    return (
      <main className="shell">
        <p>Sign in first to manage your client relationships.</p>
        <a href="/">Back to dashboard</a>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="top">
        <div>
          <div className="brand">Client Relationship Management</div>
          <div className="muted">
            Client records, project relationships and controlled scope changes
          </div>
        </div>

        <nav className="row">
          <a className="btn" href="/">Dashboard</a>
          <a className="btn" href="/workspace">Workspace</a>
          <a className="btn" href="/delivery">Delivery</a>
        </nav>
      </header>

      {message && (
        <p className="success" role="status">{message}</p>
      )}

      {error && (
        <p className="error" role="alert">{error}</p>
      )}

      <section className="card">
        <h2>{editingClientId ? 'Edit client' : 'Add client'}</h2>

        <form onSubmit={createClient} className="grid">
          <label className="field">
            Name
            <input
              required
              minLength={2}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>

          <label className="field">
            Company
            <input
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
            />
          </label>

          <label className="field">
            Email
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>

          <label className="field">
            Phone
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>

          <label className="field">
            Website
            <input
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
            />
          </label>

          <label className="field">
            Tags (comma separated)
            <input
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
            />
          </label>

          <label className="field" style={{ gridColumn: '1/-1' }}>
            Notes
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>

          <div className="row">
            <button className="btn primary" disabled={busy}>
              {editingClientId ? 'Update client' : 'Save client'}
            </button>

            {editingClientId && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setEditingClientId('');
                  setForm({
                    name: '',
                    company: '',
                    email: '',
                    phone: '',
                    website: '',
                    notes: '',
                    tags: '',
                  });
                }}
              >
                Cancel edit
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Clients ({clients.length})</h2>

          <button
            className="btn"
            disabled={busy}
            onClick={() => void load()}
          >
            Refresh
          </button>
        </div>

        {clients.length === 0 ? (
          <p className="muted">
            No client records yet. Add a client above.
          </p>
        ) : (
          clients.map((client) => (
            <article className="item" key={client.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <b>{client.name}</b>
                  {client.company && (
                    <span className="muted"> · {client.company}</span>
                  )}
                </div>

                <span className="muted">{client.status}</span>
              </div>

              <p className="muted">
                {[
                  client.email,
                  client.phone,
                  client.website,
                ].filter(Boolean).join(' · ') || 'No contact details recorded'}
              </p>

              {client.notes && <p>{client.notes}</p>}

              {client.tags.length > 0 && (
                <small className="muted">
                  Tags: {client.tags.join(', ')}
                </small>
              )}

              <p className="row">
                <button
                  className="btn"
                  onClick={() => void editClient(client)}
                >
                  Edit client
                </button>

                <button
                  className="btn"
                  onClick={() => void showActivity(client.id)}
                >
                  Load relationship history
                </button>

                <button
                  className="btn"
                  onClick={() => void showProfitability(client.id)}
                >
                  Client profitability
                </button>
              </p>

              {profitability[client.id] !== undefined && (
                <pre
                  className="item"
                  style={{ whiteSpace: 'pre-wrap' }}
                >
                  {JSON.stringify(profitability[client.id], null, 2)}
                </pre>
              )}

              {activity[client.id] && (
                <div className="item">
                  {activity[client.id].length === 0 ? (
                    <p className="muted">
                      No linked project activity recorded.
                    </p>
                  ) : (
                    activity[client.id].map((item) => (
                      <p key={`${item.type}:${item.id}`}>
                        <b>{item.type}: {item.title}</b>
                        <br />
                        <span className="muted">
                          {item.detail} ·{' '}
                          {new Date(item.occurred_at).toLocaleString()}
                        </span>
                      </p>
                    ))
                  )}
                </div>
              )}
            </article>
          ))
        )}
      </section>

      <section className="card">
        <h2>Contracts & statements of work</h2>

        <p className="muted">
          Create versioned SOW/contract drafts, then manually record sent or
          accepted status. Acceptance evidence is an owner attestation, not a
          digital signature.
        </p>

        <form onSubmit={saveContract} className="grid">
          <label className="field">
            Client
            <select
              required
              value={contractForm.client_id}
              onChange={(e) =>
                setContractForm({
                  ...contractForm,
                  client_id: e.target.value,
                })
              }
            >
              <option value="">Choose client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            Linked project (optional)
            <select
              value={contractForm.project_id}
              onChange={(e) => {
                const project = projects.find(
                  (item) => item.id === e.target.value
                );

                setContractForm({
                  ...contractForm,
                  project_id: e.target.value,
                  currency: project?.currency || 'INR',
                });
              }}
            >
              <option value="">No project link</option>
              {projects
                .filter(
                  (project) =>
                    !contractForm.client_id ||
                    project.client_id === contractForm.client_id
                )
                .map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
            </select>
          </label>

          <label className="field">
            Document title
            <input
              required
              minLength={3}
              value={contractForm.title}
              onChange={(e) =>
                setContractForm({ ...contractForm, title: e.target.value })
              }
            />
          </label>

          <label className="field">
            Type
            <select
              value={contractForm.contract_type}
              onChange={(e) =>
                setContractForm({
                  ...contractForm,
                  contract_type: e.target.value,
                })
              }
            >
              <option value="statement_of_work">Statement of Work</option>
              <option value="contract">Contract</option>
              <option value="change_order">Change Order</option>
            </select>
          </label>

          <label className="field">
            Value
            <input
              type="number"
              min="0"
              step="0.01"
              value={contractForm.value}
              onChange={(e) =>
                setContractForm({
                  ...contractForm,
                  value: Number(e.target.value),
                })
              }
            />
          </label>

          <label className="field">
            Currency
            <input
              value={contractForm.currency}
              onChange={(e) =>
                setContractForm({
                  ...contractForm,
                  currency: e.target.value.toUpperCase(),
                })
              }
            />
          </label>

          <label className="field">
            Expiry date
            <input
              type="date"
              value={contractForm.expires_on}
              onChange={(e) =>
                setContractForm({
                  ...contractForm,
                  expires_on: e.target.value,
                })
              }
            />
          </label>

          <label className="field" style={{ gridColumn: '1/-1' }}>
            Full SOW / contract text
            <textarea
              required
              minLength={30}
              rows={7}
              value={contractForm.content}
              onChange={(e) =>
                setContractForm({
                  ...contractForm,
                  content: e.target.value,
                })
              }
            />
          </label>

          <button
            className="btn primary"
            disabled={busy || !contractForm.client_id}
          >
            Save contract draft
          </button>
        </form>

        {contracts.map((contract) => (
          <article className="item" key={contract.id}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>{contract.title}</b>
              <span className="muted">
                {contract.status} · v{contract.version}
              </span>
            </div>

            <p className="muted">
              {contract.contract_type.replaceAll('_', ' ')} ·{' '}
              {contract.currency}{' '}
              {Number(contract.value).toLocaleString('en-IN')} ·{' '}
              {contract.expires_on || 'No expiry'}
            </p>

            <details>
              <summary>Review full document</summary>
              <pre style={{ whiteSpace: 'pre-wrap' }}>
                {contract.content}
              </pre>
              <small className="muted">
                Content fingerprint: {contract.content_hash}
              </small>
            </details>

            <div className="row">
              <button
                className="btn"
                disabled={
                  busy ||
                  ['accepted', 'archived', 'expired'].includes(contract.status)
                }
                onClick={() => void createContractRevision(contract)}
              >
                Create new revision
              </button>

              <button
                className="btn"
                onClick={() => void showContractRevisions(contract.id)}
              >
                View immutable revision history
              </button>
            </div>

            {contractRevisions[contract.id]?.map((revision) => (
              <div className="muted" key={revision.version}>
                v{revision.version} · {revision.title} · {revision.created_at}
                {' · '}SHA-256 {revision.content_hash.slice(0, 16)}…
              </div>
            ))}

            <div className="row">
              {contract.status === 'draft' && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => void contractDecision(contract, 'sent')}
                >
                  Record sent manually
                </button>
              )}

              {contract.status === 'sent' && (
                <>
                  <button
                    className="btn primary"
                    disabled={busy}
                    onClick={() => void contractDecision(contract, 'accepted')}
                  >
                    Record client acceptance
                  </button>

                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => void contractDecision(contract, 'rejected')}
                  >
                    Record rejection
                  </button>
                </>
              )}

              {!['accepted', 'rejected', 'archived', 'expired'].includes(
                contract.status
              ) && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => void contractDecision(contract, 'archived')}
                >
                  Archive
                </button>
              )}
            </div>

            {contract.decision_note && (
              <p className="muted">{contract.decision_note}</p>
            )}
          </article>
        ))}
      </section>

      <section className="card">
        <h2>Client communication timeline</h2>

        <p className="muted">
          Log calls, meetings, messages and manual email notes. This does not
          send communications.
        </p>

        <form onSubmit={saveCommunication} className="grid">
          <label className="field">
            Client
            <select
              required
              value={communicationForm.client_id}
              onChange={(e) =>
                setCommunicationForm({
                  ...communicationForm,
                  client_id: e.target.value,
                  project_id: '',
                })
              }
            >
              <option value="">Choose client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            Project (optional)
            <select
              value={communicationForm.project_id}
              onChange={(e) =>
                setCommunicationForm({
                  ...communicationForm,
                  project_id: e.target.value,
                })
              }
            >
              <option value="">No project link</option>
              {projects
                .filter(
                  (project) =>
                    !communicationForm.client_id ||
                    project.client_id === communicationForm.client_id
                )
                .map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
            </select>
          </label>

          <label className="field">
            Channel
            <select
              value={communicationForm.channel}
              onChange={(e) =>
                setCommunicationForm({
                  ...communicationForm,
                  channel: e.target.value,
                })
              }
            >
              <option value="note">Internal note</option>
              <option value="email">Email</option>
              <option value="call">Call</option>
              <option value="meeting">Meeting</option>
              <option value="message">Message</option>
              <option value="other">Other</option>
            </select>
          </label>

          <label className="field">
            Direction
            <select
              value={communicationForm.direction}
              onChange={(e) =>
                setCommunicationForm({
                  ...communicationForm,
                  direction: e.target.value,
                })
              }
            >
              <option value="internal">Internal</option>
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
            </select>
          </label>

          <label className="field" style={{ gridColumn: '1/-1' }}>
            Subject
            <input
              value={communicationForm.subject}
              onChange={(e) =>
                setCommunicationForm({
                  ...communicationForm,
                  subject: e.target.value,
                })
              }
            />
          </label>

          <label className="field" style={{ gridColumn: '1/-1' }}>
            Details
            <textarea
              required
              minLength={2}
              value={communicationForm.body}
              onChange={(e) =>
                setCommunicationForm({
                  ...communicationForm,
                  body: e.target.value,
                })
              }
            />
          </label>

          <button
            className="btn primary"
            disabled={busy || !communicationForm.client_id}
          >
            Add timeline entry
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Project-to-client links</h2>

        {projects.length === 0 ? (
          <p className="muted">
            Create a project before linking a client.
          </p>
        ) : (
          projects.map((project) => (
            <article className="item" key={project.id}>
              <div>
                <b>{project.title}</b>
                <p className="muted">
                  {project.client_name || 'No client linked'} ·{' '}
                  {project.currency}{' '}
                  {Number(project.budget || 0).toLocaleString('en-IN')} · Due{' '}
                  {project.due_date || 'not set'}
                </p>
              </div>

              <label className="field">
                Assign client
                <select
                  value={project.client_id || ''}
                  onChange={(e) =>
                    void linkClient(project.id, e.target.value)
                  }
                >
                  <option value="">Select a client</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                      {client.company ? ` — ${client.company}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </article>
          ))
        )}
      </section>

      <section className="card">
        <h2>Request a project scope change</h2>

        <p className="muted">
          Budget and timeline changes only take effect after explicit approval
          and confirmation that the client accepted the change.
        </p>

        <form onSubmit={createScope}>
          <label className="field">
            Project
            <select
              required
              value={scope.project_id}
              onChange={(e) => {
                const project = projects.find(
                  (item) => item.id === e.target.value
                );

                setScope({
                  ...scope,
                  project_id: e.target.value,
                  currency: project?.currency || 'INR',
                });
              }}
            >
              <option value="">Choose project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            Change title
            <input
              required
              minLength={3}
              value={scope.title}
              onChange={(e) =>
                setScope({ ...scope, title: e.target.value })
              }
            />
          </label>

          <label className="field">
            Description
            <textarea
              required
              minLength={10}
              value={scope.description}
              onChange={(e) =>
                setScope({ ...scope, description: e.target.value })
              }
            />
          </label>

          <label className="field">
            Reason
            <textarea
              value={scope.reason}
              onChange={(e) =>
                setScope({ ...scope, reason: e.target.value })
              }
            />
          </label>

          <div className="grid">
            <label className="field">
              Budget change (+/-)
              <input
                type="number"
                step="0.01"
                value={scope.budget_delta}
                onChange={(e) =>
                  setScope({
                    ...scope,
                    budget_delta: Number(e.target.value),
                  })
                }
              />
            </label>

            <label className="field">
              Currency
              <input readOnly value={scope.currency} />
            </label>

            <label className="field">
              Timeline change in days (+/-)
              <input
                type="number"
                value={scope.timeline_delta_days}
                onChange={(e) =>
                  setScope({
                    ...scope,
                    timeline_delta_days: Number(e.target.value),
                  })
                }
              />
            </label>
          </div>

          <button
            className="btn primary"
            disabled={busy || !scope.project_id}
          >
            Submit for approval
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Scope change approval history</h2>

        {changes.length === 0 ? (
          <p className="muted">No scope changes recorded.</p>
        ) : (
          changes.map((change) => (
            <article className="item" key={change.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>{change.title}</b>
                <span className="muted">{change.status}</span>
              </div>

              <p>{change.description}</p>

              <p className="muted">
                Budget: {change.budget_delta >= 0 ? '+' : ''}
                {change.currency}{' '}
                {change.budget_delta.toLocaleString('en-IN')} · Timeline:{' '}
                {change.timeline_delta_days >= 0 ? '+' : ''}
                {change.timeline_delta_days} days
              </p>

              {(change.status === 'draft' ||
                change.status === 'rejected') && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => void requestScopeApproval(change.id)}
                >
                  Submit for approval
                </button>
              )}

              {change.status === 'pending_approval' ? (
                <>
                  <label className="field">
                    <input
                      type="checkbox"
                      checked={!!accept[change.id]}
                      onChange={(e) =>
                        setAccept({
                          ...accept,
                          [change.id]: e.target.checked,
                        })
                      }
                    />
                    I confirm the client explicitly accepted this exact scope,
                    budget and timeline change.
                  </label>

                  <label className="field">
                    Acceptance evidence (e.g. email date/thread or signed
                    change order)
                    <input
                      required
                      minLength={10}
                      value={evidenceNote[change.id] || ''}
                      onChange={(e) =>
                        setEvidenceNote({
                          ...evidenceNote,
                          [change.id]: e.target.value,
                        })
                      }
                    />
                  </label>

                  <div className="row">
                    <button
                      className="btn primary"
                      disabled={
                        busy ||
                        !accept[change.id] ||
                        (evidenceNote[change.id] || '').trim().length < 10
                      }
                      onClick={() => void decide(change, 'approved')}
                    >
                      Confirm acceptance and approve
                    </button>

                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => void decide(change, 'rejected')}
                    >
                      Reject
                    </button>
                  </div>
                </>
              ) : (
                <p className="muted">
                  Client acceptance recorded:{' '}
                  {change.client_accepted ? 'Yes' : 'No'}
                  {change.decision_note
                    ? ` · ${change.decision_note}`
                    : ''}
                </p>
              )}
            </article>
          ))
        )}
      </section>

      <footer className="muted">
        Client acceptance is recorded as an attestation by the account owner.
        Keep the client's written approval outside this app as supporting
        evidence. No email is sent automatically.
      </footer>
    </main>
  );
}
