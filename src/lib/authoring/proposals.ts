import type { StudioDocument } from '../../types';
import { fitsProjectFile, serializeProject } from '../storage';
import { projectBaseToken, sameBaseToken, type BaseToken } from './base-token';

export interface ProposalBase {
  readonly document: StudioDocument;
  readonly revision: number;
}

export interface SetHeading {
  readonly op: 'setHeading';
  readonly title: string;
  readonly subtitle: string;
  readonly showTitle: boolean;
}

export interface ReadyProposal {
  readonly id: string;
  readonly state: 'ready';
}

type PreparedCandidate = {
  base: ProposalBase;
  token: BaseToken;
  document: StudioDocument;
};

export const staleHeadingMessage = 'This project changed while you were editing. Review the current heading before applying your draft.';
const invalid = () => new Error('The heading proposal is invalid.');
const prepared = new WeakMap<ReadyProposal, PreparedCandidate>();
const digestPattern = /^[a-f0-9]{64}$/;
const unpairedSurrogate = /[\uD800-\uDFFF]/u;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function closedRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw invalid();
  const properties = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(properties);
  if (keys.length !== fields.length || fields.some(field =>
    !Object.hasOwn(properties, field) || !properties[field].enumerable || !Object.hasOwn(properties[field], 'value'),
  )) throw invalid();
  return value as Record<string, unknown>;
}

/** This lane grants authority only for local, diagram-wide heading edits. */
function readHeadingEnvelope(value: unknown) {
  const envelope = closedRecord(value, ['schema', 'id', 'documentKind', 'baseToken', 'origin', 'operations']);
  if (envelope.schema !== 'meridian-proposal/v1' || typeof envelope.id !== 'string' || !uuidPattern.test(envelope.id)
    || envelope.documentKind !== 'mermaid' || envelope.origin !== 'canvas' || !Array.isArray(envelope.operations)
    || Object.getPrototypeOf(envelope.operations) !== Array.prototype
    || envelope.operations.length !== 1 || Reflect.ownKeys(envelope.operations).length !== 2) throw invalid();
  const operation = Object.getOwnPropertyDescriptor(envelope.operations, '0');
  if (!operation || !Object.hasOwn(operation, 'value')) throw invalid();
  const token = closedRecord(envelope.baseToken, ['projectId', 'revision', 'contentHash', 'stateDigest']);
  const { projectId, revision, contentHash, stateDigest } = token;
  if (typeof projectId !== 'string' || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0
    || typeof contentHash !== 'string' || !digestPattern.test(contentHash)
    || typeof stateDigest !== 'string' || !digestPattern.test(stateDigest)) throw invalid();
  const { op, title, subtitle, showTitle } = closedRecord(operation.value, ['op', 'title', 'subtitle', 'showTitle']);
  if (op !== 'setHeading' || typeof title !== 'string' || typeof subtitle !== 'string' || typeof showTitle !== 'boolean'
    || title.length > 120 || subtitle.length > 240 || unpairedSurrogate.test(title) || unpairedSurrogate.test(subtitle)) throw invalid();
  const heading: SetHeading = { op, title, subtitle, showTitle };
  return { id: envelope.id, token: { projectId, revision, contentHash, stateDigest }, heading };
}

export function workspaceBaseToken({ document, revision }: ProposalBase): Promise<BaseToken> {
  return projectBaseToken({ ...document, documentKind: 'mermaid', revision });
}

/** Metadata can be previewed without Mermaid because headings are applied during framing. */
export async function prepareHeadingProposal(base: ProposalBase, envelope: unknown): Promise<ReadyProposal> {
  const { id, token, heading } = readHeadingEnvelope(envelope);
  const snapshot = { ...base };
  const verifiedToken = await workspaceBaseToken(snapshot);
  if (!sameBaseToken(token, verifiedToken)) throw new Error(staleHeadingMessage);
  // The portable download is indented JSON. Budget the actual export, in bytes.
  const { document: current } = snapshot;
  const { title, subtitle, showTitle } = heading;
  const settings = showTitle === current.settings.showTitle ? current.settings : Object.freeze({ ...current.settings, showTitle });
  const document: StudioDocument = title === current.title && subtitle === current.subtitle && settings === current.settings
    ? current
    : Object.freeze({ ...current, title, subtitle, settings, updatedAt: new Date().toISOString() });
  if (!fitsProjectFile(serializeProject(document))) {
    throw new Error('The result is too large to export and reopen as a Meridian project.');
  }
  const grant: ReadyProposal = Object.freeze({ id, state: 'ready' });
  prepared.set(grant, { base: snapshot, token: verifiedToken, document });
  return grant;
}

/** Apply can use object identity because workspace revisions own immutable snapshots. */
export function resolvePreparedProposal(proposal: ReadyProposal, document: StudioDocument, revision: number) {
  const candidate = prepared.get(proposal);
  if (!candidate) return { status: 'invalid' } as const;
  if (candidate.token.projectId !== document.id || candidate.token.revision !== revision
    || candidate.base.document !== document) return { status: 'stale' } as const;
  return { status: 'ready', document: candidate.document } as const;
}
