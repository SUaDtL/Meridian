import { projectBaseToken, sameBaseToken } from './base-token';
import { decodeJson } from './decode-json';
import { authoringLimits } from './flowchart-source';
import type { MermaidProjectV3 } from './mermaid-project';
import recoverySchema from './schemas/recovery.schema.json';
import { matchesBundledContract, validateMermaidProject } from './validate-mermaid-project';

export const sourceRecoveryByteLimit = 4_000_000;
const encoder = new TextEncoder();
export type SourceRecoveryReason = 'annotation-limit' | 'project-size' | 'migration' | 'save-failure';

type SourceRecovery = {
  schema: 'meridian-recovery/v1';
  acceptedProject: MermaidProjectV3;
  baseStateDigest: string;
  sourceDraft: string;
  reason: SourceRecoveryReason;
};

// Apply the existing project validator and the UTF-16 source contract to their
// respective fields after validating the closed recovery envelope.
const envelopeSchema = {
  ...recoverySchema,
  properties: { ...recoverySchema.properties, acceptedProject: {}, sourceDraft: {} },
};

function verifySource(source: unknown): asserts source is string {
  if (typeof source !== 'string' || source.length > authoringLimits.sourceCodeUnits) {
    throw new Error('A recovery draft can contain up to 100,000 UTF-16 code units of Mermaid source.');
  }
}

function verifySize(text: string) {
  if (text.length > sourceRecoveryByteLimit || encoder.encode(text).byteLength > sourceRecoveryByteLimit) {
    throw new Error('Choose a Meridian recovery file no larger than 4,000,000 bytes.');
  }
}

export async function serializeSourceRecovery(project: MermaidProjectV3, sourceDraft: string, reason: SourceRecoveryReason) {
  verifySource(sourceDraft);
  const acceptedProject = validateMermaidProject(project);
  const { stateDigest: baseStateDigest } = await projectBaseToken(acceptedProject);
  const text = JSON.stringify({ schema: 'meridian-recovery/v1', acceptedProject, baseStateDigest, sourceDraft, reason });
  verifySize(text);
  return text;
}

export async function readMatchingSourceRecovery(text: string, current: MermaidProjectV3) {
  verifySize(text);
  const input = decodeJson(text, 50_010);
  if (!matchesBundledContract(input, envelopeSchema)) throw new Error('Choose a Meridian source recovery file.');
  const { acceptedProject, baseStateDigest, sourceDraft, reason } = input as SourceRecovery;
  verifySource(sourceDraft);
  const accepted = validateMermaidProject(acceptedProject);
  const [included, expected] = await Promise.all([projectBaseToken(accepted), projectBaseToken(current)]);
  if (included.stateDigest !== baseStateDigest) throw new Error('The recovery file does not match the accepted project it contains.');
  if (!sameBaseToken(included, expected)) throw new Error('Open the matching accepted project revision before restoring this draft.');
  return { sourceDraft, reason };
}
