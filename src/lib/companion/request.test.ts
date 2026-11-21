import { describe, expect, it } from 'vitest';
import { buildAssistRequest } from '../authoring/assist-exchange';
import { projectBaseToken } from '../authoring/base-token';
import fixture from '../authoring/fixtures/example-project.json';
import { validateMermaidProject } from '../authoring/validate-mermaid-project';
import { parseCompanionRequest, type CompanionRequest } from './request';

const encoder = new TextEncoder();
const nodeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const neighborId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const edgeId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const groupId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const baseToken = {
  projectId: '11111111-1111-4111-8111-111111111111', revision: 7,
  contentHash: 'a'.repeat(64), stateDigest: 'b'.repeat(64),
};

const requestFixture = (): CompanionRequest => ({
  schema: 'meridian/assist-request/v1', documentKind: 'mermaid',
  requestId: '019ad8a4-6400-7aaa-8aaa-aaaaaaaaaaaa',
  baseToken: { ...baseToken },
  instruction: 'Review the boundary 🧭.',
  scope: { readContextIds: [nodeId, neighborId, edgeId, groupId], writableElementIds: [nodeId, groupId], attachmentPointIds: [neighborId] },
  graph: {
    nodes: [
      { id: nodeId, elementKind: 'node', label: 'A', parentGroupId: groupId, incidentEdgesComplete: true, shape: 'rect' },
      { id: neighborId, elementKind: 'node', label: 'B', parentGroupId: null, incidentEdgesComplete: false, shape: 'rect' },
    ],
    edges: [{ id: edgeId, elementKind: 'edge', sourceId: nodeId, targetId: neighborId, label: '', direction: 'forward', lineStyle: 'solid' }],
    groups: [{ id: groupId, elementKind: 'group', label: 'Scope', parentGroupId: null, memberIds: [nodeId] }],
  },
  allowedOperations: ['setNodeLabel', 'moveToGroup'],
});

const bytes = (value: CompanionRequest) => encoder.encode(JSON.stringify(value));

describe('companion request ingress', () => {
  it('matches the exact canonical hash created by the core export and ignores JSON formatting', async () => {
    const document = validateMermaidProject(fixture);
    const exported = await buildAssistRequest(
      document, { schema: 'meridian-targets/v1', baseToken: await projectBaseToken(document), targets: [], renderFingerprint: 'fixture' },
      new Map(), new Map(), new Map(), 'Add one standalone system', new Set(), 'setEdgeLabel', { addNode: true },
    );
    const expected = { request: exported.request, requestHash: exported.pending.requestHash };
    await expect(parseCompanionRequest(encoder.encode(exported.text))).resolves.toEqual(expected);
    await expect(parseCompanionRequest(encoder.encode(JSON.stringify(exported.request)))).resolves.toEqual(expected);
  });

  it('preserves normalized Unicode, nested membership and explicit scopes', async () => {
    const request = requestFixture();
    const parsed = await parseCompanionRequest(bytes(request));
    expect(parsed.request).toEqual(request);
    request.instruction += ' Changed.';
    await expect(parseCompanionRequest(bytes(request))).resolves.not.toHaveProperty('requestHash', parsed.requestHash);
  });

  it.each([
    ['duplicate graph ID', (request: CompanionRequest) => { request.graph.edges[0].id = nodeId; }],
    ['repeated writable ID', (request: CompanionRequest) => { request.scope.writableElementIds.push(nodeId); }],
    ['unreadable writable ID', (request: CompanionRequest) => { request.scope.writableElementIds.push(baseToken.projectId); }],
    ['missing readable ID', (request: CompanionRequest) => { request.scope.readContextIds.pop(); }],
    ['edge as attachment', (request: CompanionRequest) => { request.scope.attachmentPointIds.push(edgeId); }],
    ['unrepresented edge endpoint', (request: CompanionRequest) => { request.graph.edges[0].sourceId = groupId; }],
    ['one-sided group membership', (request: CompanionRequest) => { request.graph.groups[0].memberIds.length = 0; }],
    ['cyclic group membership', (request: CompanionRequest) => {
      request.graph.groups[0].parentGroupId = groupId;
      request.graph.groups[0].memberIds.push(groupId);
    }],
    ['repeated operation', (request: CompanionRequest) => { request.allowedOperations.push('setNodeLabel'); }],
  ])('rejects %s', async (_, edit) => {
    const request = requestFixture();
    edit(request);
    await expect(parseCompanionRequest(bytes(request))).rejects.toThrow('scope or graph');
  });

  it.each([
    ['trailing newline after a UUID', (request: CompanionRequest) => { request.requestId += '\n'; }],
    ['trailing newline after a hash', (request: CompanionRequest) => { request.baseToken.stateDigest += '\n'; }],
    ['a node label with a line break', (request: CompanionRequest) => { request.graph.nodes[0].label += '\n'; }],
    ['an unpaired surrogate', (request: CompanionRequest) => { request.instruction = '\uD800'; }],
    ['an instruction above 2,000 code points', (request: CompanionRequest) => { request.instruction = '🧭'.repeat(2001); }],
    ['an extra source field', (request: CompanionRequest) => { Object.assign(request, { source: 'flowchart LR' }); }],
  ])('rejects %s', async (_, edit) => {
    const request = requestFixture();
    edit(request);
    await expect(parseCompanionRequest(bytes(request))).rejects.toThrow('Invalid Meridian assistant request');
  });

  it('rejects oversized bytes, malformed UTF-8, mixed duplicate keys and deep inputs before hashing', async () => {
    const valid = JSON.stringify(requestFixture());
    await expect(parseCompanionRequest(new Uint8Array(128 * 1024 + 1))).rejects.toThrow('128 KiB');
    await expect(parseCompanionRequest(new Uint8Array([0xc0, 0xaf]))).rejects.toThrow();
    await expect(parseCompanionRequest(encoder.encode(valid.replace('"schema":', '"schem\\u0061":"duplicate","schema":'))))
      .rejects.toThrow('repeated');
    await expect(parseCompanionRequest(encoder.encode('['.repeat(9) + 'null' + ']'.repeat(9)))).rejects.toThrow('nested');
  });
});
