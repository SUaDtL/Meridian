import { describe, expect, it } from 'vitest';
import { validateCompanionOperations } from './operations';
import { parseCompanionRequest, type CompanionRequest } from './request';

const writer = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const attachment = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const neighbor = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const connection = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const oldGroup = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const parentGroup = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const missing = '77777777-7777-4777-8777-777777777777';

const fixture = (): CompanionRequest => ({
  schema: 'meridian/assist-request/v1', documentKind: 'mermaid',
  requestId: '019ad8a4-6400-7aaa-8aaa-aaaaaaaaaaaa',
  baseToken: { projectId: missing, revision: 7, contentHash: 'a'.repeat(64), stateDigest: 'b'.repeat(64) },
  instruction: 'Review the systems.',
  scope: {
    readContextIds: [writer, attachment, neighbor, connection, oldGroup, parentGroup],
    writableElementIds: [writer, connection, oldGroup, parentGroup],
    attachmentPointIds: [attachment],
  },
  graph: {
    nodes: [
      { id: writer, elementKind: 'node', label: 'Writer', shape: 'rect', parentGroupId: oldGroup, incidentEdgesComplete: true },
      { id: attachment, elementKind: 'node', label: 'Attachment', shape: 'rect', parentGroupId: null, incidentEdgesComplete: false },
      { id: neighbor, elementKind: 'node', label: 'Neighbor', shape: 'rect', parentGroupId: null, incidentEdgesComplete: false },
    ],
    edges: [{ id: connection, elementKind: 'edge', sourceId: writer, targetId: neighbor, label: '', direction: 'forward', lineStyle: 'solid' }],
    groups: [
      { id: oldGroup, elementKind: 'group', label: 'Old', parentGroupId: parentGroup, memberIds: [writer] },
      { id: parentGroup, elementKind: 'group', label: 'Top', parentGroupId: null, memberIds: [oldGroup] },
    ],
  },
  allowedOperations: ['addNode', 'setNodeLabel', 'addEdge', 'setEdgeLabel', 'removeEdge', 'removeNode', 'createGroup', 'moveToGroup'],
});

const connect = (sourceId: string, targetId: string) =>
  ({ op: 'addEdge', ref: 'new:edge', sourceId, targetId, label: '', direction: 'forward', lineStyle: 'solid' });
const add = { op: 'addNode', ref: 'new:node', label: 'Cache', parentGroupId: null, shape: 'rect' };
const remove = (incidentEdgeIds: string[]) =>
  ({ op: 'removeNode', targetId: writer, incidentEdgeIds, annotationPolicy: 'preserve-orphans' });
const group = { op: 'createGroup', ref: 'new:group', label: 'New', memberIds: [writer], parentGroupId: parentGroup };
const run = (operations: unknown, request = fixture()) => validateCompanionOperations(JSON.stringify(operations), request);

describe('companion provider operation scope', () => {
  it('accepts an earlier new reference only as the correct kind and allows an expressly shared attachment', async () => {
    const { request } = await parseCompanionRequest(new TextEncoder().encode(JSON.stringify(fixture())));
    const operations = [add, connect('new:node', attachment)];
    expect(run(operations, request)).toEqual(operations);
    expect(() => run([...operations].reverse(), request)).toThrow('scope');
    expect(() => run([add, connect('new:node', neighbor)], request)).toThrow('scope');
    expect(() => run([add, { ...connect('new:node', attachment), ref: add.ref }], request)).toThrow('scope');
  });

  it.each([
    ['rename a read-only attachment', [{ op: 'setNodeLabel', targetId: attachment, label: 'Different' }]],
    ['rename a context-only neighbor', [{ op: 'setNodeLabel', targetId: neighbor, label: 'Different' }]],
    ['treat a writable connection as a node', [{ op: 'setNodeLabel', targetId: connection, label: 'Different' }]],
    ['attach to a context-only neighbor', [connect(writer, neighbor)]],
    ['attach to a writable group as if it were a node', [connect(writer, oldGroup)]],
    ['connect two endpoints without a writable node', [connect(attachment, attachment)]],
    ['delete a node while omitting its edge', [remove([])]],
    ['delete a node while repeating an edge', [remove([connection, connection])]],
    ['delete a node with an unrelated edge', [remove([missing])]],
    ['make a cycle by moving a group under its descendant', [{ op: 'moveToGroup', targetIds: [parentGroup], parentGroupId: oldGroup }]],
    ['create a group containing a read-only member', [{ ...group, memberIds: [neighbor] }]],
    ['use the same edge after deleting it', [remove([connection]), { op: 'setEdgeLabel', targetId: connection, label: 'Done' }]],
  ])('rejects a request to %s', (_, operations) => {
    expect(() => run(operations)).toThrow('scope');
  });

  it('requires incident proof and both old and new group chains to be writable', () => {
    const request = fixture();
    expect(run([remove([connection])], request)).toEqual([remove([connection])]);
    request.graph.nodes[0].incidentEdgesComplete = false;
    expect(() => run([remove([connection])], request)).toThrow('scope');
    request.graph.nodes[0].incidentEdgesComplete = true;
    request.scope.writableElementIds = [writer, oldGroup, parentGroup];
    expect(() => run([remove([connection])], request)).toThrow('scope');
    expect(run([group], request)).toEqual([group]);
    expect(request.graph.nodes[0].parentGroupId).toBe(oldGroup);
    request.scope.writableElementIds = [writer, oldGroup];
    expect(() => run([group], request)).toThrow('scope');
    expect(() => run([{ op: 'moveToGroup', targetIds: [writer], parentGroupId: null }], request)).toThrow('scope');
  });

  it('uses closed operations, per-request allowlists, conservative labels and bounded output', () => {
    const request = fixture();
    expect(() => run([{ ...add, source: 'graph TD' }], request)).toThrow('Invalid companion operations');
    expect(() => run([connect(writer, attachment), { ...add, ref: 'new:bad\n' }], request)).toThrow('Invalid companion operations');
    expect(() => run([{ ...add, label: '\u007f' }], request)).toThrow('one line');
    expect(() => run(new Array(65).fill(add), request)).toThrow('Invalid companion operations');
    expect(() => validateCompanionOperations(' '.repeat(128 * 1024 + 1), request)).toThrow('128 KiB');
    request.allowedOperations = ['setNodeLabel'];
    expect(() => run([add], request)).toThrow('scope');
  });
});
