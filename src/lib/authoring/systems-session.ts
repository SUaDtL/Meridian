import type { SystemsCheckpoint } from '../persistence/systems-drafts';
import type { SystemsDraft } from './systems-draft';

export type SystemsSession = { values: SystemsDraft; checkpoint?: SystemsCheckpoint; dirty: boolean };

export const emptySystemsSession: SystemsSession = {
  values: { title: '', direction: 'LR', nodes: [], edges: [] },
  dirty: false,
};
