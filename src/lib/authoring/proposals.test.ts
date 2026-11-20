import { describe, expect, it } from 'vitest';
import { parseProject, createDocument, serializeProject, fitsProjectFile } from '../storage';
import { workspaceReducer, workspaceState } from '../workspace';
import { prepareHeadingProposal, staleHeadingMessage, workspaceBaseToken, type ReadyProposal } from './proposals';

async function fixture() {
  const document = { ...createDocument(), title: 'Original', source: '\ufeffflowchart LR\r\n  A[Original]\r\n' };
  const workspace = workspaceState([document], document.id);
  const base = { document, revision: workspace.revision };
  const envelope = {
    schema: 'meridian-proposal/v1',
    documentKind: 'mermaid',
    origin: 'canvas',
    id: crypto.randomUUID(),
    baseToken: await workspaceBaseToken(base),
    operations: [{ op: 'setHeading', title: 'Revised', subtitle: 'Project details', showTitle: false }],
  };
  return { document, workspace, base, envelope };
}

const apply = (workspace: ReturnType<typeof workspaceState>, proposal: ReadyProposal) =>
  workspaceReducer(workspace, { type: 'proposal', proposal, at: 1020 });

describe('revision-bound native proposals', () => {
  it('applies one validated candidate atomically, and undo/redo keep source exact', async () => {
    const { document, workspace, base, envelope } = await fixture();
    const proposal = await prepareHeadingProposal(base, envelope);
    expect(workspace.documents[0]).toBe(document);
    const changed = apply(workspace, proposal);
    expect(changed.proposalOutcome).toEqual({ id: envelope.id, status: 'applied' });
    expect(changed.revision).toBe(base.revision + 1);
    expect(changed.past).toHaveLength(1);
    expect(changed.documents[0]).toMatchObject({
      title: 'Revised', subtitle: 'Project details', settings: { showTitle: false }, source: document.source,
    });
    expect(changed.documents[0].design).toBe(document.design);
    expect(parseProject(serializeProject(changed.documents[0])).source).toBe(document.source);
    const undone = workspaceReducer(changed, { type: 'undo' });
    expect(undone.documents[0]).toMatchObject({ title: 'Original', subtitle: '', source: document.source, settings: { showTitle: true } });
    expect(undone.revision).toBeGreaterThan(changed.revision);
    expect(apply(undone, proposal).proposalOutcome?.status).toBe('stale');
    expect(workspaceReducer(undone, { type: 'redo' }).documents[0].subtitle).toBe('Project details');
    expect(apply(changed, proposal).documents).toBe(changed.documents);
  });

  it('treats an identical heading as a no-op and keeps existing history', async () => {
    const { workspace, document, base, envelope } = await fixture();
    envelope.operations[0] = { op: 'setHeading', title: document.title, subtitle: document.subtitle, showTitle: document.settings.showTitle };
    const changed = apply(workspace, await prepareHeadingProposal(base, envelope));
    expect(changed.proposalOutcome?.status).toBe('unchanged');
    expect(changed.documents).toBe(workspace.documents);
    expect(changed.past).toBe(workspace.past);
    expect(changed.revision).toBe(workspace.revision);
  });

  it('rejects metadata drift at equal revision and document identity', async () => {
    const { base, envelope } = await fixture();
    const document = { ...base.document, title: 'Another tab’s title' };
    await expect(prepareHeadingProposal({ ...base, document }, envelope)).rejects.toThrow(staleHeadingMessage);
  });

  it('rejects a prepared result after intervening source and reload actions', async () => {
    const { workspace, base, envelope } = await fixture();
    const preparing = prepareHeadingProposal(base, envelope);
    const edited = workspaceReducer(workspace, { type: 'patch', patch: { source: 'flowchart LR\nB[New]' }, label: 'Edit source', at: 1000 });
    const proposal = await preparing;
    const rejected = apply(edited, proposal);
    expect(rejected.proposalOutcome?.status).toBe('stale');
    expect(rejected.documents).toBe(edited.documents);
    expect(rejected.past).toBe(edited.past);
    const replaced = workspaceReducer(edited, { type: 'replace', documents: workspace.documents, activeId: workspace.activeId });
    expect(replaced.revision).toBe(edited.revision + 1);
    expect(apply(replaced, proposal).proposalOutcome?.status).toBe('stale');
  });

  it('seals the exact inputs before an asynchronous digest', async () => {
    const { workspace, base, envelope } = await fixture();
    const preparing = prepareHeadingProposal(base, envelope);
    envelope.operations[0].title = 'Replaced after validation started';
    expect(apply(workspace, await preparing).documents[0].title).toBe('Revised');
  });

  it('rejects forged readiness and refuses out-of-scope fields and operations', async () => {
    const { workspace, base, envelope } = await fixture();
    const forged = apply(workspace, { id: envelope.id, state: 'ready' });
    expect(forged.proposalOutcome?.status).toBe('invalid');
    expect(forged.documents).toBe(workspace.documents);
    const [heading] = envelope.operations;
    for (const invalid of [
      { ...envelope, state: 'ready' },
      { ...envelope, origin: 'ai' },
      { ...envelope, documentKind: 'chart' },
      { ...envelope, operations: [heading, heading] },
      { ...envelope, operations: [{ ...heading, targetIds: [] }] },
      { ...envelope, operations: [{ op: 'addNode', label: 'Inserted' }] },
      { ...envelope, operations: [{ ...heading, title: '\uD800' }] },
    ]) {
      await expect(prepareHeadingProposal(base, invalid)).rejects.toThrow('heading proposal is invalid');
    }
    await expect(prepareHeadingProposal(base, { ...envelope, operations: [{ ...heading, title: '🔒' }] })).resolves.toMatchObject({ state: 'ready' });
  });

  it('budgets portable UTF-8 bytes, including authored metadata', async () => {
    const { base, envelope } = await fixture();
    const elements = Object.fromEntries(Array.from({ length: 700 }, (_, index) =>
      [`node:${index}${'界'.repeat(975)}`, { fill: '#123456' }]));
    const document = { ...base.document, design: { ...base.document.design, elements } };
    const large = { ...base, document };
    const materialized = serializeProject(document);
    expect(materialized.length).toBeLessThan(2_000_000);
    expect(fitsProjectFile(materialized)).toBe(false);
    expect(() => parseProject(materialized)).toThrow('too large');
    const candidate = { ...envelope, baseToken: await workspaceBaseToken(large) };
    await expect(prepareHeadingProposal(large, candidate)).rejects.toThrow('too large to export and reopen');
  });
});
