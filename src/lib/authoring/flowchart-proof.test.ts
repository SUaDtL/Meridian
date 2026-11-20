import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderResult } from '../../types';
import type { FlowModel } from '../design';
import { flowchartModelFor, renderDiagram } from '../render';
import { createDocument } from '../storage';
import { proveFlowchartEdit } from './flowchart-proof';

vi.mock('../render', () => ({ renderDiagram: vi.fn(), flowchartModelFor: vi.fn() }));

const source = 'flowchart LR\n A[Start]\n B[Finish]\n A first@--> B\n A second@--> B\n linkStyle 1 stroke:#00bb00';
const project = { ...createDocument(), source };
const output: RenderResult = { svg: '', diagramType: 'flowchart-v2', nodes: [], edgeCount: 2, width: 10, height: 10, warnings: [] };

function graph(): FlowModel {
  return {
    direction: 'LR',
    classCount: 0,
    groups: [],
    vertices: new Map([
      ['A', { id: 'A', type: 'square', text: 'Start', labelType: 'text' }],
      ['B', { id: 'B', type: 'square', text: 'Finish', labelType: 'text' }],
    ]),
    edges: [
      { id: 'first', isUserDefinedId: true, start: 'A', end: 'B', type: 'arrow_point', length: 1, stroke: 'normal', text: '' },
      { id: 'second', isUserDefinedId: true, start: 'A', end: 'B', type: 'arrow_point', length: 1, stroke: 'normal', text: '', style: ['stroke:#00bb00', 'fill:none'] },
    ],
  };
}

describe('whole-graph Mermaid comparison', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(renderDiagram).mockResolvedValue(output);
  });

  it('stops at the base render when the scanner and pinned parser disagree', async () => {
    const before = graph();
    before.edges[0].end = 'A';
    vi.mocked(flowchartModelFor).mockReturnValueOnce(before);
    await expect(proveFlowchartEdit(project, { op: 'removeEdge', sourceId: 'first' })).rejects.toThrow('read a different diagram');
    expect(renderDiagram).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['surviving edge style', (after: FlowModel) => { after.edges[0].style = ['stroke:#ff0000']; }],
    ['unrelated node label', (after: FlowModel) => { after.vertices.get('B')!.text = 'Replaced'; }],
    ['surviving edge endpoint', (after: FlowModel) => { after.edges[0].start = 'B'; }],
    ['default style', (after: FlowModel) => { after.defaultStyle = ['stroke:#ff0000']; }],
  ])('refuses a change to %s even when the output has the expected edge count', async (_field, mutate) => {
    const before = graph();
    const after = graph();
    after.edges.shift();
    mutate(after);
    vi.mocked(flowchartModelFor).mockReturnValueOnce(before).mockReturnValueOnce(after);
    await expect(proveFlowchartEdit(project, { op: 'removeEdge', sourceId: 'first' })).rejects.toThrow('read a different diagram');
    expect(renderDiagram).toHaveBeenCalledTimes(2);
    expect(project.source).toBe(source);
  });
});
