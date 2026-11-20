export interface BaseToken {
  projectId: string;
  revision: number;
  contentHash: string;
  stateDigest: string;
}

type WorkingProject = { id: string; revision: number; updatedAt: string } & (
  | { documentKind: 'mermaid'; source: string }
  | { documentKind: 'chart'; dataset: unknown; chartSpec: unknown }
);

const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const textEncoder = new TextEncoder();

/** Meridian canonical JSON v1. Source strings are escaped before UTF-8 encoding. */
export function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 64) throw new Error('DEPTH_LIMIT');
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('NONFINITE_NUMBER');
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error('UNSAFE_INTEGER');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
      throw new Error('SPARSE_ARRAY');
    }
    return '[' + value.map(item => canonicalJson(item, depth + 1)).join(',') + ']';
  }
  if (typeof value !== 'object') throw new Error('NON_JSON_VALUE');

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) throw new Error('NON_JSON_OBJECT');
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.some(key => forbiddenKeys.has(key))) throw new Error('FORBIDDEN_KEY');
  return '{' + keys.map(key => JSON.stringify(key) + ':' + canonicalJson(record[key], depth + 1)).join(',') + '}';
}

export async function canonicalDigest(domain: string, value: unknown): Promise<string> {
  const bytes = textEncoder.encode(domain + '\0' + canonicalJson(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Capture both digest inputs synchronously from the same snapshot before awaiting either hash. */
export async function projectBaseToken<Project extends WorkingProject>(project: Project): Promise<BaseToken> {
  const { id, revision, updatedAt: _updatedAt, ...authored } = project;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('INVALID_REVISION');
  const content = project.documentKind === 'mermaid'
    ? canonicalDigest('meridian-source/v1', project.source)
    : canonicalDigest('meridian-chart-content/v1', { dataset: project.dataset, chartSpec: project.chartSpec });
  const [contentHash, stateDigest] = await Promise.all([
    content,
    canonicalDigest('meridian-authored-state/v1', authored),
  ]);
  return { projectId: id, revision, contentHash, stateDigest };
}

export function sameBaseToken(a: BaseToken, b: BaseToken): boolean {
  return a.projectId === b.projectId && a.revision === b.revision
    && a.contentHash === b.contentHash && a.stateDigest === b.stateDigest;
}
