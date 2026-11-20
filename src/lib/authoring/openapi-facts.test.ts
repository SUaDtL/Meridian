import { expect, it } from 'vitest';
import { readOpenApiFacts, validateVirtualPath } from './openapi-facts';

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
