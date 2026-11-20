import TableWorker from './relationship-table.worker?worker&inline';
import { runAuthoringWorker } from './authoring-worker';
import { tableInputLimits, type DelimitedRow, type TableDelimiter } from './delimited-input';
import type { RelationshipColumns, RelationshipGraph } from './relationship-table';

export async function readRelationshipTable(text: string, delimiter: TableDelimiter, signal: AbortSignal, extended = false) {
  signal.throwIfAborted();
  if (text.length > tableInputLimits.bytes) throw new Error('Use a table no larger than 2,000,000 bytes.');
  return runAuthoringWorker<DelimitedRow[]>(() => new TableWorker(), { action: 'read', text, delimiter }, signal, 'Reading the relationship table', extended);
}

export function mapTableInWorker(rows: DelimitedRow[], columns: RelationshipColumns, header: boolean, signal: AbortSignal, extended = false) {
  return runAuthoringWorker<RelationshipGraph>(() => new TableWorker(), { action: 'map', rows, columns, header }, signal, 'Mapping the relationships', extended);
}
