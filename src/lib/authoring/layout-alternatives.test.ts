import { expect, test } from 'vitest';
import { applySourcePatches, planFlowchartDirection } from './source-patches';

test('keeps a synonymous direction byte-for-byte and patches only the exact header token otherwise', () => {
  const source = '\uFEFFgraph TD\r\n  %% TD stays in the comment\r\n  A["TD stays in this label"]\r\n';
  expect(planFlowchartDirection(source, 'TB')).toEqual([]);
  const edit = planFlowchartDirection(source, 'RL');
  expect(edit).toHaveLength(1);
  expect(applySourcePatches(source, edit)).toBe(source.replace('graph TD', 'graph RL'));
  expect(() => planFlowchartDirection('flowchart LR\nA --> B', 'TB')).toThrow(/outside the supported editing subset/);
});
