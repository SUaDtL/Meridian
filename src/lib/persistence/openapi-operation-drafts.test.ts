import { expect, test } from 'vitest';
import { readOpenApiOperationCheckpoint, restoreOpenApiOperations } from './openapi-operation-drafts';

function checkpoint() {
  const virtualPath = 'spec/service.json';
  return {
    schema: 'meridian-draft/v1', feature: 'engineering-facts', baseToken: null,
    id: 'd34a6bd0-5765-4616-8f34-e54e40b5df51', createdAt: '2026-11-20T00:00:00.000Z', expiresAt: '2026-11-27T00:00:00.000Z',
    payload: {
      step: 'scope', title: 'One service', subtitle: '', adapter: 'openapi', adapterVersion: '1.0.0', dialect: '3.1.0',
      virtualPaths: [virtualPath], facts: [{ id: 'o1', externalKey: 'GET /items/~filter', label: 'Find items',
        kind: 'operation', virtualPath, pointer: '/paths/~1items~1~0filter/get', parentId: null, role: null, status: 'resolved', reason: '' }],
      relationships: [], selectedFactIds: ['o1'], selectedRelationshipIds: [], unresolvedPolicy: 'exclude',
      openApiOperations: { referencedPathCount: 2, uncheckedSchemaCount: 1, details: [{ factId: 'o1',
        method: 'get', path: '/items/~filter', tags: ['Items', 'Lookup'], primaryTagIndex: 1 }] },
    },
  };
}

test('restores the exact operation identity, escaped provenance and reviewed tag index', () => {
  const saved = checkpoint();
  const restored = readOpenApiOperationCheckpoint(saved);
  expect(restored).toEqual(saved);
  if (!restored) throw new Error('The checkpoint was not recognized.');
  expect(restoreOpenApiOperations(restored)).toEqual({
    title: 'One service', selection: new Map([['GET /items/~filter', {
      key: 'GET /items/~filter', label: 'Find items', tag: 'Lookup',
    }]]),
    facts: { version: '3.1.0', virtualPath: 'spec/service.json', referencedPathCount: 2, uncheckedSchemaCount: 1,
      operations: [{ key: 'GET /items/~filter', pointer: '/paths/~1items~1~0filter/get', method: 'get', path: '/items/~filter', tags: ['Items', 'Lookup'] }] },
  });
});

test('rejects stale tag indexes, altered provenance and undeclared draft fields', () => {
  const wrongTag = checkpoint();
  wrongTag.payload.openApiOperations.details[0].primaryTagIndex = 2;
  expect(readOpenApiOperationCheckpoint(wrongTag)).toBeUndefined();
  const wrongPointer = checkpoint();
  wrongPointer.payload.facts[0].pointer = '/paths/~1items~1filter/get';
  expect(readOpenApiOperationCheckpoint(wrongPointer)).toBeUndefined();
  const wrongSelection = checkpoint();
  wrongSelection.payload.selectedFactIds = ['o2'];
  expect(readOpenApiOperationCheckpoint(wrongSelection)).toBeUndefined();
  const extraContent = checkpoint();
  expect(readOpenApiOperationCheckpoint({ ...extraContent, payload: { ...extraContent.payload, description: 'raw input' } })).toBeUndefined();
});
