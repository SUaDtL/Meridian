import { solidTextContrast, type SolidTextPaint } from './solid-text-color';

export type ViewingProfile = { width: number; height: number; padding: number };
export type FrameGeometry = { width: number; height: number; diagramScale: number };
export type ReadabilityTarget = {
  id: string;
  kind: 'node' | 'group' | 'edge';
  label: string;
  sourceId?: string;
  typography: boolean;
  measuredLabelSize?: number;
  labelOverflowInDiagram?: number;
  solidTextPaint?: SolidTextPaint;
  from: string | null;
  to: string | null;
};

export type ReadabilityFinding =
  | { rule: 'QC-01'; target: string; ratio: number; threshold: number }
  | { rule: 'QC-03'; target: string; pixels: number }
  | { rule: 'QC-04'; target: string; pixels: number }
  | { rule: 'QC-05'; targets: string[] }
  | { rule: 'QC-06'; regions: string[][] };

export type ReadabilityReport = {
  findings: ReadabilityFinding[];
  coverage: { rule: ReadabilityFinding['rule']; measured: number; unknown: number; inapplicable: number }[];
};

export const minimumAdvisoryLabelSize = 14;
export const labelOverflowTolerance = 0.5;

export function viewingScale(profile: ViewingProfile, frame: FrameGeometry): number {
  if (!Number.isInteger(profile.width) || !Number.isInteger(profile.height) || !Number.isInteger(profile.padding)
    || profile.width < 100 || profile.height < 100 || profile.width > 8192 || profile.height > 8192 || profile.padding < 0
    || profile.padding * 2 >= Math.min(profile.width, profile.height)) throw new Error('Choose a viewing area between 100 and 8192 CSS pixels with room inside its padding.');
  if (![frame.width, frame.height, frame.diagramScale].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('The current diagram did not provide stable viewing measurements.');
  }
  return frame.diagramScale * Math.min((profile.width - profile.padding * 2) / frame.width,
    (profile.height - profile.padding * 2) / frame.height);
}

export function normalizedName(label: string) {
  return label.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function weakRegions(targets: readonly ReadabilityTarget[]): string[][] | undefined {
  const known = new Map(targets.map(target => [target.id, target.kind]));
  if (known.size !== targets.length) return undefined;
  const vertices = new Map(targets.filter(target => target.kind === 'node').map(target => [target.id, new Set<string>()]));
  function endpoint(id: string) {
    let neighbors = vertices.get(id);
    if (!neighbors && known.get(id) === 'group') {
      neighbors = new Set();
      vertices.set(id, neighbors);
    }
    return neighbors;
  }
  for (const edge of targets) {
    if (edge.kind !== 'edge') continue;
    if (!edge.from || !edge.to) return undefined;
    const from = endpoint(edge.from);
    const to = endpoint(edge.to);
    if (!from || !to) return undefined;
    from.add(edge.to);
    to.add(edge.from);
  }
  const regions: string[][] = [];
  const visited = new Set<string>();
  for (const seed of vertices.keys()) {
    if (visited.has(seed)) continue;
    const region = [seed];
    visited.add(seed);
    for (let position = 0; position < region.length; position++) {
      for (const next of vertices.get(region[position]) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        region.push(next);
      }
    }
    regions.push(region);
  }
  return regions;
}

export function analyzeReadability(targets: readonly ReadabilityTarget[], profile: ViewingProfile, frame: FrameGeometry): ReadabilityReport {
  if (targets.length > 2_000) throw new Error('The diagram has too many targets for one readability check.');
  const scale = viewingScale(profile, frame);
  const findings: ReadabilityFinding[] = [];
  const coverageFor = (rule: ReadabilityFinding['rule']) => ({ rule, measured: 0, unknown: 0, inapplicable: 0 });
  const size = coverageFor('QC-03');
  const names = coverageFor('QC-05');
  const separation = coverageFor('QC-06');
  const contrast = coverageFor('QC-01');
  const containment = coverageFor('QC-04');
  const duplicateNames = new Map<string, string[]>();
  for (const item of targets) {
    const overflow = item.labelOverflowInDiagram;
    if (!item.typography) containment.inapplicable++;
    else if (overflow === undefined || !Number.isFinite(overflow) || overflow < 0) containment.unknown++;
    else {
      containment.measured++;
      const pixels = overflow * scale;
      if (pixels > labelOverflowTolerance) findings.push({ rule: 'QC-04', target: item.id, pixels });
    }
    const measured = item.measuredLabelSize;
    if (!item.typography) {
      size.inapplicable++;
      contrast.inapplicable++;
    } else if (typeof measured !== 'number' || !Number.isFinite(measured) || measured <= 0) {
      size.unknown++;
      contrast.unknown++;
    }
    else {
      size.measured++;
      const pixels = measured * scale;
      if (pixels < minimumAdvisoryLabelSize) findings.push({ rule: 'QC-03', target: item.id, pixels });
      if (item.solidTextPaint) {
        contrast.measured++;
        const { ratio, threshold } = solidTextContrast(item.solidTextPaint, pixels);
        if (ratio < threshold) findings.push({ rule: 'QC-01', target: item.id, ratio, threshold });
      } else contrast.unknown++;
    }
    if (item.kind === 'edge') {
      names.inapplicable++;
      continue;
    }
    const name = normalizedName(item.label);
    if (!name) {
      names.inapplicable++;
      continue;
    }
    names.measured++;
    const key = `${item.kind}:${name}`;
    const group = duplicateNames.get(key) ?? [];
    group.push(item.id);
    duplicateNames.set(key, group);
  }
  for (const group of duplicateNames.values()) if (group.length > 1) findings.push({ rule: 'QC-05', targets: group });
  const regions = weakRegions(targets);
  if (regions === undefined) separation.unknown = 1;
  else if (!regions.length) separation.inapplicable = 1;
  else {
    separation.measured = 1;
    if (regions.length > 1) findings.push({ rule: 'QC-06', regions });
  }
  return { findings, coverage: [size, names, separation, contrast, containment] };
}
