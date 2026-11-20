import { validateChartDataset, type ChartDataset, type ChartSpec } from '../authoring/chart-data';
import { elementUuidPattern } from '../authoring/identities';
import common from '../authoring/schemas/common.schema.json';
import { matchesBundledContract } from '../authoring/validate-mermaid-project';
import { draftBytes, draftWeek, listGuidedCheckpoints, maxDraftBytes, sameCheckpoint, saveGuidedCheckpoint } from './guided-drafts';

type Conversion = { fieldId: string; emptyToNull: boolean; grouping: 'none'; decimal: 'period'; invalid: 'block' };
type CheckpointInput = {
  title: string;
  subtitle: string;
  dataset: ChartDataset;
  chartSpec: ChartSpec | null;
  delimiter: 'comma' | 'tab' | 'semicolon';
  conversions: Conversion[];
};

function chartCheckpoint(input: CheckpointInput, id: string, timestamp: number) {
  if (typeof id !== 'string' || !elementUuidPattern.test(id) || !Number.isFinite(timestamp)
    || typeof input.title !== 'string' || [...input.title].length > 120
    || typeof input.subtitle !== 'string' || [...input.subtitle].length > 240
    || /[\uD800-\uDFFF]/u.test(input.title + input.subtitle)
    || !['comma', 'tab', 'semicolon'].includes(input.delimiter)
    || !matchesBundledContract(input.dataset, common.$defs.Dataset)
    || (input.chartSpec !== null && !matchesBundledContract(input.chartSpec, common.$defs.ChartSpec))) {
    throw new Error('This chart draft could not be saved.');
  }
  const dataset = validateChartDataset(input.dataset);
  const fields = new Set(dataset.fields.map(field => field.id));
  if (!Array.isArray(input.conversions) || input.conversions.length !== fields.size
    || new Set(input.conversions.map(item => item.fieldId)).size !== fields.size
    || input.conversions.some(rule => !fields.has(rule.fieldId) || typeof rule.emptyToNull !== 'boolean'
      || rule.grouping !== 'none' || rule.decimal !== 'period' || rule.invalid !== 'block')) throw new Error('The chart conversion rules are incomplete.');
  const conversions = input.conversions.map(({ fieldId, emptyToNull, grouping, decimal, invalid }) => ({ fieldId, emptyToNull, grouping, decimal, invalid }));
  return {
    schema: 'meridian-draft/v1' as const, feature: 'chart' as const, baseToken: null,
    id, createdAt: new Date(timestamp).toISOString(), expiresAt: new Date(timestamp + draftWeek).toISOString(),
    payload: { step: 'mapping' as const, title: input.title, subtitle: input.subtitle, dataset,
      chartSpec: input.chartSpec, delimiter: input.delimiter, conversions, selectedFieldIds: [], selectedRowIds: [] },
  };
}

export type ChartCheckpoint = ReturnType<typeof chartCheckpoint>;

function readCheckpoint(value: unknown) {
  try {
    const record = value as ChartCheckpoint;
    if (record?.feature !== 'chart') return undefined;
    const expected = chartCheckpoint(record.payload, record.id, Date.parse(record.createdAt));
    return sameCheckpoint(record, expected) && draftBytes(expected) <= maxDraftBytes ? expected : undefined;
  } catch {
    return undefined;
  }
}

export function listChartCheckpoints(db: IDBDatabase) {
  return listGuidedCheckpoints(db, readCheckpoint);
}

export function saveChartCheckpoint(db: IDBDatabase, input: CheckpointInput, previous?: ChartCheckpoint) {
  const now = Date.now();
  const next = chartCheckpoint(input, previous?.id ?? crypto.randomUUID(), now);
  return saveGuidedCheckpoint(db, next, previous, now);
}
