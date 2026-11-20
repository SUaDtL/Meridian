import { readDelimitedRows } from './delimited-input';
import { mapRelationshipTable } from './relationship-table';

self.addEventListener('message', (event: MessageEvent) => {
  const { version, id, action, text, delimiter, rows, columns, header } = event.data ?? {};
  if (version !== 1 || typeof id !== 'string') return;
  try {
    if (action === 'read' && typeof text === 'string' && (delimiter === ',' || delimiter === '\t')) {
      self.postMessage({ version, id, status: 'ready', result: readDelimitedRows(text, delimiter) });
    } else if (action === 'map' && Array.isArray(rows) && columns && typeof header === 'boolean') {
      self.postMessage({ version, id, status: 'ready', result: mapRelationshipTable(rows, columns, header) });
    }
  } catch (reason) {
    self.postMessage({ version, id, status: 'failed', message: reason instanceof Error ? reason.message : 'The table could not be read.' });
  }
});
