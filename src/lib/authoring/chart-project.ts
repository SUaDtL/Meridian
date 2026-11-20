import { fitsProjectFile } from '../storage';
import { chartDataLimits, type ChartProject } from './chart-data';
import { projectChartValues } from './chart-values';
import { decodeJson } from './decode-json';
import { matchesBundledContract } from './validate-mermaid-project';
import portable from './schemas/project.schema.json';

export function validateChartProject(value: unknown) {
  if (!matchesBundledContract(value, portable.oneOf[1])) throw new Error('The document does not match the Meridian chart format.');
  const project = value as ChartProject;
  if (!fitsProjectFile(JSON.stringify(project))) throw new Error('The materialized chart exceeds 2,000,000 bytes.');
  return { project, projection: projectChartValues(project) };
}

export function parseChartProject(text: string) {
  if (!fitsProjectFile(text)) throw new Error('Choose a chart project of at most 2,000,000 bytes.');
  return validateChartProject(decodeJson(text, chartDataLimits.cells + chartDataLimits.rows * 3 + 2_000));
}
