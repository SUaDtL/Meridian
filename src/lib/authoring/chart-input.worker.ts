import { confirmChartColumns, readChartInput, type ChartInput, type ChartInputFormat, type ColumnConfirmation } from './chart-input';

type ChartWorkerAction =
  | { action: 'read'; bytes: ArrayBuffer; format: ChartInputFormat }
  | { action: 'confirm'; input: ChartInput; columns: (ColumnConfirmation | null)[] };

self.onmessage = ({ data }: MessageEvent<ChartWorkerAction & { id: string; version: 1 }>) => {
  if (data?.version !== 1 || typeof data.id !== 'string') return;
  try {
    let result;
    if (data.action === 'read') {
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(data.bytes);
      } catch {
        throw new Error('Choose a data file encoded as UTF-8.');
      }
      result = readChartInput(text, data.format);
    } else {
      result = confirmChartColumns(data.input, data.columns);
    }
    self.postMessage({ version: 1, id: data.id, status: 'ready', result });
  } catch (error) {
    self.postMessage({ version: 1, id: data.id, status: 'failed',
      message: error instanceof Error ? error.message : 'The chart data could not be read.' });
  }
};
