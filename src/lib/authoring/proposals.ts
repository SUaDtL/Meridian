import type { StudioDocument } from '../../types';
import { fitsProjectFile, serializeProject } from '../storage';
import { projectBaseToken, sameBaseToken, type BaseToken } from './base-token';

export interface ProposalBase<Project = StudioDocument> {
  readonly document: Project;
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

export const staleHeadingMessage = 'This project changed while you were editing. Review the current heading before applying your draft.';
const invalid = () => new Error('The heading proposal is invalid.');
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

export type HeadingDocument = Pick<StudioDocument, 'id' | 'source' | 'title' | 'subtitle' | 'settings' | 'updatedAt'>;

export function workspaceBaseToken({ document, revision }: ProposalBase<HeadingDocument>): Promise<BaseToken> {
  return projectBaseToken({ ...document, documentKind: 'mermaid', revision });
}

export function createHeadingProposalLane<Project extends HeadingDocument>(
  finalize: (draft: Project, base: ProposalBase<Project>) => Project,
) {
  const prepared = new WeakMap<ReadyProposal, { base: ProposalBase<Project>; projectId: string; document: Project }>();

  /** Headings are applied during framing and can be prepared without Mermaid. */
  async function prepare(base: ProposalBase<Project>, envelope: unknown): Promise<ReadyProposal> {
    const { id, token, heading } = readHeadingEnvelope(envelope);
    const snapshot = { ...base };
    const verifiedToken = await workspaceBaseToken(snapshot);
    if (!sameBaseToken(token, verifiedToken)) throw new Error(staleHeadingMessage);
    const { document: current } = snapshot;
    const { title, subtitle, showTitle } = heading;
    const settings = showTitle === current.settings.showTitle ? current.settings : Object.freeze({ ...current.settings, showTitle });
    const draft = title === current.title && subtitle === current.subtitle && settings === current.settings
      ? current
      : { ...current, title, subtitle, settings, updatedAt: new Date().toISOString() };
    const document = finalize(draft, snapshot);
    const grant: ReadyProposal = Object.freeze({ id, state: 'ready' });
    prepared.set(grant, { base: snapshot, projectId: verifiedToken.projectId, document });
    return grant;
  }

  function resolve(proposal: ReadyProposal, document: Project, revision: number) {
    const candidate = prepared.get(proposal);
    if (!candidate) return { status: 'invalid' } as const;
    if (candidate.projectId !== document.id || candidate.base.revision !== revision || candidate.base.document !== document) {
      return { status: 'stale' } as const;
    }
    return { status: 'ready', document: candidate.document } as const;
  }

  return { prepare, resolve };
}

const legacyHeadingLane = createHeadingProposalLane<StudioDocument>((document, base) => {
  if (!fitsProjectFile(serializeProject(document))) {
    throw new Error('The result is too large to export and reopen as a Meridian project.');
  }
  return document === base.document ? document : Object.freeze(document);
});

export const prepareHeadingProposal = legacyHeadingLane.prepare;
export const resolvePreparedProposal = legacyHeadingLane.resolve;
