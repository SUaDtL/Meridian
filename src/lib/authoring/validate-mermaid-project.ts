import type { MermaidProjectV3 } from './mermaid-project';
import { decodeJson } from './decode-json';
import { MAX_LIVE_IDENTITIES, MAX_RETAINED_IDENTITY_RECORDS, sourceBindingKey } from './identities';
import { fitsProjectFile, serializeProject } from '../storage';
import common from './schemas/common.schema.json';
import project from './schemas/project.schema.json';

interface Schema {
  $ref?: string;
  type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean' | 'null';
  const?: string | number | boolean;
  enum?: readonly (string | number | boolean)[];
  anyOf?: readonly Schema[];
  oneOf?: readonly Schema[];
  required?: readonly string[];
  properties?: Readonly<Record<string, Schema>>;
  additionalProperties?: false | Schema;
  propertyNames?: Schema;
  items?: Schema;
  pattern?: string;
  format?: 'date-time';
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minProperties?: number;
  maxProperties?: number;
  minimum?: number;
  maximum?: number;
}

const mermaidSchema = project.oneOf[0] as unknown as Schema;
const sharedSchemas = common.$defs as unknown as Readonly<Record<string, Schema>>;
const referencePrefix = common.$id + '#/$defs/';
const unpairedSurrogate = /[\uD800-\uDFFF]/u;
const dateTime = /^(\d{4})-(\d\d)-(\d\d)T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i;
const patterns = new Map<string, RegExp>();
const supported = new Set([
  '$ref', '$comment', '$id', '$schema', 'type', 'const', 'enum', 'anyOf', 'oneOf', 'required', 'properties', 'additionalProperties',
  'propertyNames', 'items', 'pattern', 'format', 'minLength', 'maxLength', 'minItems', 'maxItems',
  'minProperties', 'maxProperties', 'minimum', 'maximum',
]);

function object(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validDateTime(value: string) {
  const match = dateTime.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const lastDay = new Date(0);
  lastDay.setUTCFullYear(year, month, 0);
  return month >= 1 && month <= 12 && day >= 1 && day <= lastDay.getUTCDate();
}

function within(size: number, min = 0, max = Infinity) { return size >= min && size <= max; }

/** The shipped Mermaid branch uses only these assertions. References never load files. */
function agrees(value: unknown, rule: Schema, source = false): boolean {
  for (const key of Object.keys(rule)) if (!supported.has(key)) throw new Error('Unsupported Meridian project schema assertion.');
  if (rule.$ref) {
    const name = rule.$ref.startsWith(referencePrefix) ? rule.$ref.slice(referencePrefix.length) : '';
    if (!Object.hasOwn(sharedSchemas, name)) throw new Error('Unsupported Meridian project schema reference.');
    if (!agrees(value, sharedSchemas[name], source)) return false;
  }
  if (rule.const !== undefined && value !== rule.const) return false;
  if (rule.enum && !rule.enum.some(option => option === value)) return false;
  if (rule.anyOf && !rule.anyOf.some(option => agrees(value, option, source))) return false;
  if (rule.oneOf && rule.oneOf.filter(option => agrees(value, option, source)).length !== 1) return false;
  switch (rule.type) {
    case 'object': {
      if (!object(value)) return false;
      const keys = Reflect.ownKeys(value);
      if (!within(keys.length, rule.minProperties, rule.maxProperties)
        || rule.required?.some(key => !Object.hasOwn(value, key))) return false;
      return keys.every(key => {
        if (typeof key !== 'string' || (rule.propertyNames && !agrees(key, rule.propertyNames))) return false;
        const entry = Object.getOwnPropertyDescriptor(value, key);
        if (!entry?.enumerable || !Object.hasOwn(entry, 'value')) return false;
        const own = rule.properties && Object.hasOwn(rule.properties, key) ? rule.properties[key] : undefined;
        if (own) return agrees(entry.value, own, rule === mermaidSchema && key === 'source');
        const additional = rule.additionalProperties;
        return additional !== false && (!additional || agrees(entry.value, additional));
      });
    }
    case 'array':
      if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
          || !within(value.length, rule.minItems, rule.maxItems) || Reflect.ownKeys(value).length !== value.length + 1) return false;
      for (let index = 0; index < value.length; index++) {
        const entry = Object.getOwnPropertyDescriptor(value, index);
        if (!entry?.enumerable || !Object.hasOwn(entry, 'value') || (rule.items && !agrees(entry.value, rule.items))) return false;
      }
      return true;
    case 'string': {
      if (typeof value !== 'string' || (!source && unpairedSurrogate.test(value))) return false;
      if (rule.maxLength !== undefined || rule.minLength !== undefined) {
        // Modern Meridian's source and heading budgets are measured in UTF-16.
        const size = source ? value.length : [...value].length;
        if (!within(size, rule.minLength, rule.maxLength)) return false;
      }
      if (rule.pattern) {
        let pattern = patterns.get(rule.pattern);
        if (!pattern) patterns.set(rule.pattern, pattern = new RegExp(rule.pattern, 'u'));
        if (!pattern.test(value)) return false;
      }
      return rule.format !== 'date-time' || validDateTime(value);
    }
    case 'integer':
      if (!Number.isSafeInteger(value)) return false;
      return within(value as number, rule.minimum ?? -Infinity, rule.maximum);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        && within(value, rule.minimum ?? -Infinity, rule.maximum);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    case undefined: return true;
    default: throw new Error('Unsupported Meridian project schema type.');
  }
}

export function matchesBundledContract(value: unknown, schema: unknown) {
  return agrees(value, schema as Schema);
}

function verifyReferences(document: MermaidProjectV3) {
  const invalid = () => new Error('The Meridian project contains inconsistent identities or references.');
  const records = new Map(document.identity.elements.map(record => [record.id, record]));
  const resolved = document.identity.elements.filter(record => record.status === 'resolved');
  const live = new Map(resolved.map(record => [record.id, record]));
  if (records.size !== document.identity.elements.length || live.size > MAX_LIVE_IDENTITIES
      || new Set(resolved.map(sourceBindingKey)).size !== live.size
      || records.size - live.size + document.identity.orphans.length > MAX_RETAINED_IDENTITY_RECORDS) throw invalid();
  for (const record of records.values()) {
    if ((record.elementKind === 'edge') === (record.binding.type === 'source-id')
        || record.binding.sourceId.length > 200
        || (record.binding.type === 'legacy-edge' && record.binding.targetId.length > 200)) throw invalid();
  }

  function requireTargets(ids: readonly string[], kind?: 'edge') {
    if (new Set(ids).size !== ids.length || ids.some(id => !live.has(id) || (kind && live.get(id)?.elementKind !== kind))) {
      throw invalid();
    }
  }
  requireTargets(Object.keys(document.design.elements));
  requireTargets(Object.keys(document.design.recipeElements));
  requireTargets(document.roles.map(role => role.elementId));
  if (document.provenance.some(item => !live.has(item.elementId))) throw invalid();
  const instances = document.componentInstances;
  const instanceIds = new Set(instances.map(instance => instance.id));
  if (instanceIds.size !== instances.length) throw invalid();
  for (const instance of instances) {
    if (new Set(instance.bindings.map(binding => binding.localId)).size !== instance.bindings.length) throw invalid();
    requireTargets(instance.bindings.map(binding => binding.elementId));
  }
  const sceneIds = new Set(document.storyboard.scenes.map(scene => scene.id));
  if (sceneIds.size !== document.storyboard.scenes.length) throw invalid();
  for (const scene of document.storyboard.scenes) {
    if (scene.title.length > 120 || scene.transition > Math.min(10, scene.duration)) throw invalid();
    requireTargets(scene.visible ?? []);
    requireTargets(scene.highlight);
    requireTargets(scene.flow, 'edge');
    requireTargets(scene.camera.keys);
  }
  if (new Set(document.identity.orphans.map(orphan => orphan.id)).size !== document.identity.orphans.length) throw invalid();
  for (const orphan of document.identity.orphans) {
    if ((orphan.formerElementId !== null && !records.has(orphan.formerElementId))
        || orphan.retained.sceneReferences?.some(slot => !sceneIds.has(slot.sceneId))
        || orphan.retained.componentIds?.some(instance => !instanceIds.has(instance))) throw invalid();
  }
}

/** Validate the authoritative v3 Mermaid shape and its cross-record relationships. */
export function validateMermaidProject(value: unknown): MermaidProjectV3 {
  if (!agrees(value, mermaidSchema)) throw new Error('This is not a valid Meridian v3 Mermaid project.');
  const document = value as MermaidProjectV3;
  const serialized = serializeProject(document);
  if (document.title.length > 120 || document.subtitle.length > 240 || !fitsProjectFile(serialized)) {
    throw new Error('This Meridian project exceeds its portable file limits.');
  }
  verifyReferences(document);
  decodeJson(serialized);
  return document;
}

export function parseMermaidProject(text: string): MermaidProjectV3 {
  if (!fitsProjectFile(text)) throw new Error('This project file is too large. Open a file smaller than 2 MB.');
  return validateMermaidProject(decodeJson(text));
}
