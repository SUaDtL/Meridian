import { validateComponentDefinition, type ComponentDefinition } from './component-definition';

type Node = ComponentDefinition['fragment']['nodes'][number];
type Edge = ComponentDefinition['fragment']['edges'][number];
const node = (id: string, label: string, role: Node['role'], shape: Node['shape'] = 'rect'): Node => ({ id, label, role, shape });
const edge = (id: string, sourceId: string, targetId: string, label = ''): Edge => ({ id, sourceId, targetId, label, direction: 'forward' });

function definition(details: Pick<ComponentDefinition, 'id' | 'name' | 'description' | 'tags' | 'fragment' | 'ports'>): ComponentDefinition {
  return validateComponentDefinition({
    ...details, schema: 'meridian-component/v1', family: 'flowchart', version: '1.0.0',
    provenance: { author: 'Meridian contributors', source: 'Bundled Meridian examples', license: '', licenseText: '' },
    parameters: [], labelBindings: [],
  });
}

export const curatedComponents = Object.freeze([
  definition({
    id: 'a705019a-079b-4f73-8f92-407b0d9b8433', name: 'API, queue, and worker',
    description: 'Receive work through an API, queue it, and process it in a worker.', tags: ['architecture', 'async'],
    fragment: {
      nodes: [node('api', 'API', 'service'), node('queue', 'Work queue', 'queue', 'cylinder'), node('worker', 'Worker', 'service')],
      edges: [edge('enqueue', 'api', 'queue', 'Enqueue'), edge('consume', 'queue', 'worker', 'Consume')], groups: [],
    },
    ports: [{ id: 'request', nodeId: 'api', label: 'Request input', direction: 'in' }, { id: 'result', nodeId: 'worker', label: 'Worker result', direction: 'out' }],
  }),
  definition({
    id: 'bfa87b64-3ceb-4d14-94e8-8b461e276e2d', name: 'Approval branch',
    description: 'Review a request and follow either the approval or rejection path.', tags: ['process', 'decision'],
    fragment: {
      nodes: [node('request', 'Receive request', 'process'), node('review', 'Approve request?', 'decision', 'diamond'),
        node('approve', 'Approve', 'process'), node('reject', 'Reject', 'process')],
      edges: [edge('evaluate', 'request', 'review'), edge('approved', 'review', 'approve', 'Yes'), edge('rejected', 'review', 'reject', 'No')], groups: [],
    },
    ports: [{ id: 'input', nodeId: 'request', label: 'Request input', direction: 'in' },
      { id: 'approved-output', nodeId: 'approve', label: 'Approved output', direction: 'out' },
      { id: 'rejected-output', nodeId: 'reject', label: 'Rejected output', direction: 'out' }],
  }),
  definition({
    id: 'eaaa34bf-fc5a-4ca8-ad5f-02d5c686c88a', name: 'Delivery pipeline',
    description: 'Build, test, and release a change.', tags: ['engineering', 'process'],
    fragment: {
      nodes: [node('build', 'Build', 'process'), node('test', 'Test', 'process'), node('release', 'Release', 'process')],
      edges: [edge('verify', 'build', 'test'), edge('publish', 'test', 'release')], groups: [],
    },
    ports: [{ id: 'change', nodeId: 'build', label: 'Change input', direction: 'in' },
      { id: 'delivery', nodeId: 'release', label: 'Release output', direction: 'out' }],
  }),
]);
