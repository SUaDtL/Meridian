import { authoringLimits } from './flowchart-source';

export interface ProcessStep {
  line: number;
  original: string;
  label: string;
}

export function normalizeProcessSteps(raw: string): ProcessStep[] {
  if (raw.length > authoringLimits.sourceCodeUnits) throw new Error('The process input is too large.');
  const steps: ProcessStep[] = [];
  raw.split(/\r\n|\n|\r/).forEach((original, index) => {
    const trimmed = original.trim();
    if (!trimmed) return;
    const label = trimmed.replace(/^(?:[-*•]|\d+\.) +/, '');
    if (Array.from(label).length > authoringLimits.labelCodePoints) throw new Error(`Shorten the label on line ${index + 1} to at most 200 characters.`);
    steps.push({ line: index + 1, original, label });
  });
  if (!steps.length || steps.length > authoringLimits.graphNodes) throw new Error('Enter between 1 and 200 process steps.');
  return steps;
}

