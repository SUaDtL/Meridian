import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { downloadBlob } from '../lib/download';
import {
  checkStatus, readFile, readSession, requestProposal, signOut, usd, type Outcome, type ReviewedFile, type Session,
} from './client';
import './style.css';

const operationLabels = {
  addNode: 'Add a node', setNodeLabel: 'Rename a node', addEdge: 'Add a connection', setEdgeLabel: 'Change a connection label',
  removeEdge: 'Remove a connection', removeNode: 'Remove a node and its incident connections',
  createGroup: 'Create a group', moveToGroup: 'Move elements into a group',
};

function Disclosure({ file }: { file: ReviewedFile }) {
  const { request } = file;
  const { nodes, edges, groups } = request.graph;
  const writable = new Set(request.scope.writableElementIds);
  const attachments = new Set(request.scope.attachmentPointIds);
  const labelCounts = new Map<string, number>();
  for (const item of [...nodes, ...groups]) labelCounts.set(item.label, (labelCounts.get(item.label) ?? 0) + 1);
  const labelFor = ({ id, label }: { id: string; label: string }) => (labelCounts.get(label) ?? 0) > 1
    ? `${label} (${id.slice(-8)})` : label;
  const labels = new Map(nodes.map(node => [node.id, labelFor(node)]));
  const access = (id: string) => [writable.has(id) ? 'Writable' : 'Read-only context', attachments.has(id) && 'Attachment point']
    .filter(Boolean).join(', ');
  return <section aria-labelledby="scope-heading">
    <h2 id="scope-heading">What will be shared</h2>
    <p className="instruction">{request.instruction}</p>
    <dl className="scope">
      <dt>Nodes</dt><dd>{nodes.length ? <ul>{nodes.map(node =>
        <li key={node.id}>{labelFor(node)} <span>{access(node.id)}</span></li>)}</ul> : 'None'}</dd>
      <dt>Connections</dt><dd>{edges.length ? <ul>{edges.map(edge =>
        <li key={edge.id}>{labels.get(edge.sourceId)} {edge.direction === 'forward' ? 'to' : 'with'} {labels.get(edge.targetId)}
          {edge.label && ` · ${edge.label}`} <span>{access(edge.id)}</span></li>)}</ul> : 'None'}</dd>
      <dt>Groups</dt><dd>{groups.length ? <ul>{groups.map(group =>
        <li key={group.id}>{labelFor(group)} <span>{access(group.id)}</span></li>)}</ul> : 'None'}</dd>
      <dt>Allowed changes</dt><dd><ul>{request.allowedOperations.map(operation =>
        <li key={operation}>{operationLabels[operation]}</li>)}</ul></dd>
    </dl>
    <details><summary>View exact request JSON</summary><pre>{JSON.stringify(request, null, 2)}</pre></details>
  </section>;
}

function App() {
  const [file, setFile] = useState<ReviewedFile>();
  const [session, setSession] = useState<Session | null>();
  const [work, setWork] = useState<'file' | 'generate' | 'status' | 'session' | 'logout' | null>('session');
  const [acknowledged, setAcknowledged] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  const [error, setError] = useState('');
  const cancellation = useRef<AbortController | null>(null);

  async function refreshSession() {
    setWork('session');
    setError('');
    setAcknowledged(false);
    try { setSession(await readSession()); }
    catch { setSession(undefined); setError('The companion session is unavailable. Try refreshing the session.'); }
    finally { setWork(null); }
  }

  useEffect(() => { void refreshSession(); }, []);

  async function selectFile(selected?: File) {
    if (!selected) return;
    setWork('file');
    setFile(undefined);
    setAcknowledged(false);
    setAttempted(false);
    setOutcome(undefined);
    setError('');
    try { setFile(await readFile(selected)); }
    catch { setError('Choose a valid Meridian assistant request file of 128 KiB or less.'); }
    finally { setWork(null); }
  }

  async function run(mode: 'generate' | 'status') {
    if (!file || !session || work) return;
    if (mode === 'generate' && (!acknowledged || attempted || !session.enabled || !session.policy ||
      !session.globalCapacity || BigInt(session.remaining) < BigInt(session.policy.maximum))) return;
    const controller = new AbortController();
    cancellation.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 35_000);
    setWork(mode);
    setError('');
    setOutcome(undefined);
    if (mode === 'generate') setAttempted(true);
    try {
      const result = mode === 'generate'
        ? await requestProposal(session, file, controller.signal)
        : await checkStatus(file, controller.signal);
      if (result.signedOut) {
        setSession(null);
        setAcknowledged(false);
      }
      setOutcome(result);
    } catch {
      setError(mode === 'generate'
        ? 'The browser did not receive a verified result. Generation may have started and incurred a charge. Check status before considering a new request.'
        : 'The browser could not read a verified status. You can check again.');
    } finally {
      window.clearTimeout(timeout);
      cancellation.current = null;
      setWork(null);
    }
  }

  async function logout() {
    if (!session || work) return;
    setWork('logout');
    setError('');
    try {
      await signOut(session);
      setSession(null);
      setFile(undefined);
      setAttempted(false);
      setAcknowledged(false);
      setOutcome(undefined);
    } catch { setError('The companion could not end this session.'); }
    finally { setWork(null); }
  }

  const available = Boolean(session?.enabled && session.policy && session.globalCapacity &&
    BigInt(session.remaining) >= BigInt(session.policy.maximum));
  return <main>
    <header>
      <h1>Meridian Assistant</h1>
      {session && <button type="button" disabled={!!work} onClick={() => void logout()}>Sign out</button>}
    </header>
    <p>Open a request exported from Meridian. Generate a proposal, then download and review it in Meridian before applying.</p>
    <section aria-labelledby="request-heading">
      <h2 id="request-heading">Request file</h2>
      <label htmlFor="request">Choose a Meridian request</label>
      <input id="request" type="file" accept=".json,application/json" disabled={!!work} onChange={event => {
        const selected = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        void selectFile(selected);
      }} />
      <p>Opening the file keeps its contents in this tab until you choose Generate proposal.</p>
    </section>
    {file && <Disclosure file={file} />}
    <section aria-labelledby="generate-heading">
      <h2 id="generate-heading">Generate or recover a proposal</h2>
      {session === null && <p><a href="/auth/login">Sign in to the companion</a> to continue.</p>}
      {session !== null && work !== 'session' &&
        <button type="button" disabled={!!work} onClick={() => void refreshSession()}>Refresh session</button>}
      {session && <p>{session.model} · Available today {usd(session.remaining)} USD</p>}
      {session && !available && <p>Generation is currently unavailable for this session.</p>}
      {session?.policy && file && <label className="acknowledgment">
        <input type="checkbox" checked={acknowledged} disabled={!available || !!work || attempted}
          onChange={event => setAcknowledged(event.currentTarget.checked)} />
        <span>I authorize sending the reviewed request to this companion and its model provider, with a maximum charge of {usd(session.policy.maximum)} USD.</span>
      </label>}
      <div className="actions">
        <button className="primary" type="button" disabled={!file || !available || !acknowledged || attempted || !!work}
          onClick={() => void run('generate')}>Generate proposal</button>
        <button type="button" disabled={!file || !session || !!work} onClick={() => void run('status')}>Check status</button>
        {work === 'generate' && <button type="button" onClick={() => cancellation.current?.abort()}>Stop waiting</button>}
        {outcome?.proposal && <button type="button" onClick={() => {
          downloadBlob(new Blob([outcome.proposal!], { type: 'application/json' }), 'meridian-proposal.json');
        }}>Download proposal</button>}
      </div>
      <div role="status">
        {work === 'session' && 'Checking companion session…'}
        {work === 'file' && 'Checking request file…'}
        {work === 'generate' && 'Waiting for the companion. Stopping the wait does not cancel provider work or any charge.'}
        {work === 'status' && 'Checking request status…'}
        {outcome?.message}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  </main>;
}

createRoot(document.getElementById('companion')!).render(<App />);
