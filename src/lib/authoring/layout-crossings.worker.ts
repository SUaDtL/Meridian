import { analyzeCrossings, type CrossingSummary, type LayoutCrossingComparison } from './crossing-findings';

type Routes = Parameters<typeof analyzeCrossings>[0];

function summarize(routes: Routes): CrossingSummary {
  if (routes.length > 2_000) throw new Error('A diagram exceeds the route comparison limit.');
  const { coverage, evidence } = analyzeCrossings(routes);
  return { count: evidence.count, measured: coverage.measured, unknown: coverage.unknown, checked: evidence.checked,
    skipped: evidence.skipped, routesOverSegmentLimit: evidence.routesOverSegmentLimit };
}

self.onmessage = ({ data }: MessageEvent<{ version: 1; id: string; current: Routes; proposed: Routes }>) => {
  if (data?.version !== 1 || typeof data.id !== 'string') return;
  try {
    const result: LayoutCrossingComparison = { current: summarize(data.current), proposed: summarize(data.proposed) };
    self.postMessage({ version: 1, id: data.id, status: 'ready', result });
  } catch (reason) {
    self.postMessage({ version: 1, id: data.id, status: 'failed',
      message: reason instanceof Error ? reason.message : 'The routes could not be compared.' });
  }
};
