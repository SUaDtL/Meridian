import { describe, expect, it } from 'vitest';
import { readSchemaFacts } from './schema-facts';

const encode = (text: string) => new TextEncoder().encode(text).buffer;
const file = (virtualPath: string, schema: unknown) => ({ virtualPath, bytes: encode(JSON.stringify(schema)) });

describe('JSON Schema local facts', () => {
  it('resolves relative files, normalized IDs, anchors, escaped pointers and a direct reference cycle', () => {
    const a = file('api/common.json', {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['pet/profile~1'],
      properties: {
        'pet/profile~1': { $ref: '../models/common.json#Pet' },
        escaped: { $ref: '#/properties/pet~1profile~01' },
        relativeToId: { $ref: 'https://schema.example/types/pet.json#Pet' },
      },
    });
    const b = file('models/common.json', {
      $id: 'https://schema.example/types/./pet.json',
      $anchor: 'Pet',
      properties: { api: { $ref: 'https://meridian-import.invalid/api/common.json' } },
    });
    const result = readSchemaFacts([a, b]);
    const references = result.links.filter(link => link.kind === 'Declared schema reference');
    expect(result.unresolved).toEqual([]);
    expect(references).toHaveLength(4);
    expect(references[0]).toMatchObject({
      to: 'https://schema.example/types/pet.json#', pointer: '/properties/pet~1profile~01/$ref',
    });
    expect(references[1].to).toBe(references[0].from);
    expect(references[2].to).toBe(references[0].to);
    expect(references[3].to).toBe('https://meridian-import.invalid/api/common.json#');
    expect(result.facts.find(item => item.label === 'pet/profile~1')).toMatchObject({ required: true });
    expect(new Set(result.facts.map(item => item.key)).size).toBe(result.facts.length);
  });

  it('retains coverage limitations without copying examples, raw references, or nested IDs in annotations', () => {
    const result = readSchemaFacts([file('root.json', {
      $id: 'https://example.invalid/schema',
      oneOf: [{ type: 'object' }],
      examples: [{ $id: 'https://secret.example/raw-example' }],
      description: 'raw-description-secret',
      properties: {
        dynamic: { $dynamicRef: '#node' },
        external: { $ref: 'https://secret.example/private-resource' },
        numeric: { $ref: 123 },
        node: { $dynamicAnchor: 'node' },
      },
    })]);
    expect(result.checkedReferences).toBe(2);
    expect(result.compositionCount).toBe(1);
    expect(result.unresolved).toHaveLength(4);
    expect(JSON.stringify(result)).not.toMatch(/raw-description-secret|secret\.example|#node/);
  });

  it.each([
    ['duplicate keys', '{"type":"object","type":"object"}', /repeated object key/],
    ['percent escapes', '{"$ref":"#/%FF"}', /malformed percent/],
    ['pointer escapes', '{"$ref":"#/properties/~2broken"}', /malformed JSON Pointer/],
    ['escaped traversal', '{"$ref":"%2e%2e/secret.json"}', /outside its logical root/],
    ['dialect', '{"$schema":"http://json-schema.org/draft-07/schema#"}', /different dialect/],
  ])('rejects %s before producing facts', (_, source, message) => {
    expect(() => readSchemaFacts([{ virtualPath: 'root.json', bytes: encode(source) }])).toThrow(message);
  });

  it('rejects duplicate virtual paths and normalized logical IDs', () => {
    expect(() => readSchemaFacts([file('root.json', {}), file('root.json', {})])).toThrow(/distinct virtual path/);
    expect(() => readSchemaFacts([
      file('a.json', { $id: 'https://example.invalid/x/%62.json' }),
      file('b.json', { $id: 'https://example.invalid/x/b.json' }),
    ])).toThrow(/same normalized ID/);
  });
});
