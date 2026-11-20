import { expect, test } from 'vitest';
import { parseComponentDefinition, validateComponentDefinition } from './component-definition';
import { curatedComponents } from './curated-components';

test('round-trips bundled component definitions through the declared contract', () => {
  expect(curatedComponents).toHaveLength(3);
  for (const component of curatedComponents) expect(parseComponentDefinition(JSON.stringify(component))).toEqual(component);
});

test('rejects unknown fields, HTML labels, duplicate identities and dangling edges', () => {
  const fixture = curatedComponents[0];
  expect(() => validateComponentDefinition({ ...fixture, resource: '/unplanned.svg' })).toThrow(/contract/);
  const content = structuredClone(fixture);
  content.fragment.nodes[0].label = '<strong>API</strong>';
  expect(() => validateComponentDefinition(content)).toThrow(/plain text/);
  content.fragment.nodes[0].label = 'API';
  content.fragment.edges[0].targetId = 'missing';
  expect(() => validateComponentDefinition(content)).toThrow(/missing endpoint/);
  content.fragment.nodes[0].id = content.fragment.nodes[1].id;
  expect(() => validateComponentDefinition(content)).toThrow(/distinct local ID/);
});

test('rejects cyclic groups and out-of-range default parameter values', () => {
  const fixture = structuredClone(curatedComponents[0]);
  fixture.fragment.groups = [{ id: 'outer', label: 'Outer', members: ['inner'], parentId: 'inner' },
    { id: 'inner', label: 'Inner', members: ['outer'], parentId: 'outer' }];
  expect(() => validateComponentDefinition(fixture)).toThrow(/cycle/);
  fixture.fragment.groups = [];
  fixture.parameters = [{ id: 'count', type: 'integer', label: 'Count', required: true, default: 9, minimum: 1, maximum: 5 }];
  expect(() => validateComponentDefinition(fixture)).toThrow(/default outside its range/);
});
