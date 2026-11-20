export type ViewingProfile = { width: number; height: number; padding: number };
export type FrameGeometry = { width: number; height: number; diagramScale: number };
export type ReadabilityTarget = {
  id: string;
  kind: 'node' | 'group' | 'edge';
  label: string;
  typography: boolean;
  measuredLabelSize?: number;
  from: string | null;
  to: string | null;
};

export type ReadabilityFinding =
  | { rule: 'QC-03'; target: string; pixels: number }
  | { rule: 'QC-05'; targets: string[] }
  | { rule: 'QC-06'; regions: string[][] };

export type ReadabilityReport = {
  findings: ReadabilityFinding[];
  coverage: { rule: ReadabilityFinding['rule']; measured: number; unknown: number; inapplicable: number }[];
};

export const minimumAdvisoryLabelSize = 14;

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

function normalizedName(label: string) {
  return label.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function weakRegions(targets: readonly ReadabilityTarget[]): string[][] | undefined {
  if (targets.some(target => target.kind === 'group')) return undefined;
  const nodes = new Map(targets.filter(target => target.kind === 'node').map(target => [target.id, new Set<string>()]));
  for (const edge of targets) {
    if (edge.kind !== 'edge') continue;
    const from = edge.from && nodes.get(edge.from);
    const to = edge.to && nodes.get(edge.to);
    if (!from || !to || !edge.from || !edge.to) return undefined;
    from.add(edge.to);
    to.add(edge.from);
  }
  const regions: string[][] = [];
  const visited = new Set<string>();
  for (const seed of nodes.keys()) {
    if (visited.has(seed)) continue;
    const region = [seed];
    visited.add(seed);
    for (let position = 0; position < region.length; position++) {
      for (const next of nodes.get(region[position]) ?? []) {
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
  const coverage: ReadabilityReport['coverage'] = [
    { rule: 'QC-03', measured: 0, unknown: 0, inapplicable: 0 },
    { rule: 'QC-05', measured: 0, unknown: 0, inapplicable: 0 },
    { rule: 'QC-06', measured: 0, unknown: 0, inapplicable: 0 },
  ];
  const duplicateNames = new Map<string, string[]>();
  for (const item of targets) {
    const measured = item.measuredLabelSize;
    if (!item.typography) coverage[0].inapplicable++;
    else if (typeof measured !== 'number' || !Number.isFinite(measured) || measured <= 0) coverage[0].unknown++;
    else {
      coverage[0].measured++;
      const pixels = measured * scale;
      if (pixels < minimumAdvisoryLabelSize) findings.push({ rule: 'QC-03', target: item.id, pixels });
    }
    if (item.kind === 'edge') {
      coverage[1].inapplicable++;
      continue;
    }
    const name = normalizedName(item.label);
    if (!name) {
      coverage[1].inapplicable++;
      continue;
    }
    coverage[1].measured++;
    const key = `${item.kind}:${name}`;
    const group = duplicateNames.get(key) ?? [];
    group.push(item.id);
    duplicateNames.set(key, group);
  }
  for (const group of duplicateNames.values()) if (group.length > 1) findings.push({ rule: 'QC-05', targets: group });
  const regions = weakRegions(targets);
  if (regions === undefined) coverage[2].unknown = 1;
  else if (!regions.length) coverage[2].inapplicable = 1;
  else {
    coverage[2].measured = 1;
    if (regions.length > 1) findings.push({ rule: 'QC-06', regions });
  }
  return { findings, coverage };
}
