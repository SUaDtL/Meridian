import { expect, it } from 'vitest';
import { readOpenApiFacts, validateVirtualPath } from './openapi-facts';
import { readRestrictedOpenApiYaml } from './openapi-yaml';

const bytes = (text: string) => new TextEncoder().encode(text).buffer;

it('extracts only authored operation and tag facts, pointer-escapes paths, and discloses unchecked coverage', () => {
  const input = {
    openapi: '3.1.0',
    info: { description: 'should never leave the parser' },
    paths: {
      '/accounts/~id': { get: { operationId: 'findAccount', tags: ['Accounts', 'Read'], description: 'sensitive example' } },
      '/pets': { post: { tags: ['Pets'], requestBody: { example: 'temporary raw request' } } },
      '/referenced': { $ref: 'https://example.invalid/external.json', get: { operationId: 'ambiguous' } },
    },
    components: { schemas: { Input: { type: 'object' } } },
  };
  const facts = readOpenApiFacts(bytes(JSON.stringify(input)), 'api/spec.json');
  expect(facts).toEqual({
    version: '3.1.0', virtualPath: 'api/spec.json', referencedPathCount: 1, uncheckedSchemaCount: 1,
    operations: [
      { key: 'findAccount', method: 'get', path: '/accounts/~id', tags: ['Accounts', 'Read'], pointer: '/paths/~1accounts~1~0id/get' },
      { key: 'POST /pets', method: 'post', path: '/pets', tags: ['Pets'], pointer: '/paths/~1pets/post' },
    ],
  });
  expect(JSON.stringify(facts)).not.toMatch(/sensitive|temporary|example\.invalid|ambiguous/);
});

it('rejects duplicate keys, duplicate operation identities, invalid UTF-8, versions, and ambiguous virtual paths', () => {
  const duplicateKey = bytes('{"openapi":"3.0.3","paths":{"/a":{"get":{},"get":{}}}}');
  expect(() => readOpenApiFacts(duplicateKey, 'api.json')).toThrow('repeated object key');
  const duplicateId = bytes('{"openapi":"3.0.3","paths":{"/a":{"get":{"operationId":"same"}},"/b":{"post":{"operationId":"same"}}}}');
  expect(() => readOpenApiFacts(duplicateId, 'api.json')).toThrow('identities must be unique');
  expect(() => readOpenApiFacts(new Uint8Array([0xC3, 0x28]).buffer, 'api.json')).toThrow('UTF-8');
  expect(() => readOpenApiFacts(bytes('{"openapi":"3.2.0","paths":{}}'), 'api.json')).toThrow('3.0 or 3.1');
  for (const path of ['../spec.json', '/api.json', 'a//b.json', 'a\\b.json', 'a/./b.json', '%2e%2e/a.json']) {
    expect(() => validateVirtualPath(path)).toThrow('relative virtual path');
  }
});

const fromYaml = (text: string) => readOpenApiFacts(bytes(text), 'specification.yaml', readRestrictedOpenApiYaml);

it('reads checked YAML operation facts and keeps ignored source fields in the worker', () => {
  const facts = fromYaml([
    'openapi: 3.1.0',
    'info:',
    '  description: |',
    '    raw example remains local',
    '  unused: 10000000000000000000000000000000000000000001',
    'paths:',
    '  /items/{id}:',
    '    get:',
    '      operationId: !!str itemDetails',
    '      tags: [Inventory, Read]',
    '  /remote:',
    '    $ref: https://example.invalid/hidden-path.yaml',
  ].join('\n'));
  expect(facts.operations).toEqual([{
    key: 'itemDetails', method: 'get', tags: ['Inventory', 'Read'], path: '/items/{id}', pointer: '/paths/~1items~1{id}/get',
  }]);
  expect(facts.referencedPathCount).toBe(1);
  expect(JSON.stringify(facts)).not.toMatch(/raw example|hidden-path/);
});

it.each([
  ['duplicate mapping keys', 'openapi: 3.1.0\npaths: {}\npaths: {}', /repeated mapping key/],
  ['aliases', 'openapi: 3.1.0\nshared: &x {}\npaths: *x', /aliases are unsupported/],
  ['custom tags', 'openapi: 3.1.0\npaths: !custom {}', /standard YAML 1.2 tags only/],
  ['multiple documents', 'openapi: 3.1.0\npaths: {}\n---\nopenapi: 3.0.0\npaths: {}', /must contain one document/],
  ['non-string mapping keys', 'openapi: 3.1.0\npaths: {}\n1: value', /string mapping keys/],
  ['reserved mapping keys', 'openapi: 3.1.0\npaths: {}\nconstructor: value', /string mapping keys/],
  ['excess nesting', 'openapi: 3.1.0\npaths: {}\nnested: ' + '['.repeat(65) + '0' + ']'.repeat(65), /supported depth/],
])('rejects YAML %s before producing facts', (_, input, message) => {
  expect(() => fromYaml(input)).toThrow(message);
});

it('requires actual string values for OpenAPI IDs in either encoding', () => {
  expect(() => readOpenApiFacts(bytes('{"openapi":"3.1.0","paths":{"/sample":{"get":{"operationId":123}}}}'), 'api.json'))
    .toThrow(/operation ID exceeds/);
  expect(() => fromYaml('openapi: 3.1.0\npaths:\n  /sample:\n    get:\n      operationId: 123'))
    .toThrow(/operation ID exceeds/);
});
