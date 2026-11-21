import { decodeJson } from './decode-json';
import { validateVirtualPath } from './openapi-facts';

const name = '[A-Za-z_][A-Za-z_0-9-]*';
const numericIndex = '(?:\\[(?:0|[1-9][0-9]*)\\])?';
const moduleStep = new RegExp(`^module\\.${name}${numericIndex}$`);
const resourceAddress = new RegExp(`^((?:module\\.${name}${numericIndex}\\.)*)((?:data\\.)?${name}\\.${name}${numericIndex})$`);
const attribute = new RegExp(`^(?:\\.${name})*$`);
const bounded = (value: string) => value.length > 0 && value.length <= 200 && value === value.trim();
const identifier = new RegExp(`^${name}$`);
const at = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const token = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1');

export function terraformResourceModule(address: string): string | null | undefined {
  const match = bounded(address) && resourceAddress.exec(address);
  if (!match || match[2].startsWith('module.')) return undefined;
  return match[1] ? match[1].slice(0, -1) : null;
}

export type TerraformFacts = {
  virtualPath: string;
  planned: boolean;
  hasConfiguration: boolean;
  unmatchedConfiguration: number;
  omitted: number;
  unresolved: number;
  resources: { address: string; module: string | null; pointer: string }[];
  references: { source: string; target: string; pointer: string }[];
};

/** Read addresses and declared references only. Values, changes and constants stay in the worker. */
export function readTerraformFacts(bytes: ArrayBuffer, virtualPath: string): TerraformFacts {
  validateVirtualPath(virtualPath);
  if (bytes.byteLength > 2_000_000) throw new Error('Choose a file no larger than 2,000,000 bytes.');
  const root = at(decodeJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), 50_000, 'text'));
  if (!root || typeof root.format_version !== 'string' || !/^1\.\d+$/.test(root.format_version)) {
    throw new Error('Choose Terraform show JSON with format_version 1.x.');
  }
  const planned = Object.hasOwn(root, 'planned_values');
  const valuesKey = planned ? 'planned_values' : 'values';
  const inventory = at(at(root[valuesKey])?.root_module);
  if (!inventory) throw new Error('The file does not contain a Terraform root module inventory.');
  const config = at(at(root.configuration)?.root_module);
  const resources: TerraformFacts['resources'] = [];
  const references: TerraformFacts['references'] = [];
  const addresses = new Set<string>();
  const modules = new Set<string>();
  let omitted = 0;
  let unresolved = 0;

  function inventoryModule(module: Record<string, unknown>, prefix: string, pointer: string) {
    list(module.resources).forEach((value, index) => {
      const { address } = at(value) ?? {};
      const moduleAddress = prefix ? prefix.slice(0, -1) : null;
      if (typeof address !== 'string' || terraformResourceModule(address) !== moduleAddress) {
        omitted++;
        return;
      }
      if (addresses.has(address)) throw new Error('The inventory has duplicate resource addresses.');
      addresses.add(address);
      resources.push({ address, module: moduleAddress, pointer: `${pointer}/resources/${index}` });
    });
    list(module.child_modules).forEach((value, index) => {
      const child = at(value);
      if (!child) return;
      const { address } = child;
      if (typeof address !== 'string' || !bounded(address) || !address.startsWith(prefix) || !moduleStep.test(address.slice(prefix.length))) {
        omitted++;
        return;
      }
      if (modules.has(address)) throw new Error('The inventory has duplicate module addresses.');
      modules.add(address);
      inventoryModule(child, address + '.', `${pointer}/child_modules/${index}`);
    });
  }

  inventoryModule(inventory, '', `/${valuesKey}/root_module`);

  const pairs = new Set<string>();
  const configured = new Set<string>();
  function addReference(value: unknown, source: string, prefix: string, pointer: string) {
    if (typeof value !== 'string' || value.length > 400 || value !== value.trim() || pointer.length > 1000) { unresolved++; return; }
    const qualified = prefix + value;
    let offset = qualified.length;
    // Terraform references may include trailing attribute selectors.
    while (offset > 0 && !addresses.has(qualified.slice(0, offset))) offset = qualified.lastIndexOf('.', offset - 1);
    if (offset <= 0 || !attribute.test(qualified.slice(offset))) { unresolved++; return; }
    const target = qualified.slice(0, offset);
    const pair = JSON.stringify([source, target]);
    if (pairs.has(pair)) return;
    pairs.add(pair);
    references.push({ source, target, pointer });
  }

  function configurationModule(module: Record<string, unknown>, prefix: string, pointer: string) {
    list(module.resources).forEach((entry, index) => {
      const item = at(entry);
      if (!item || typeof item.address !== 'string') return;
      const source = prefix + item.address;
      if (!addresses.has(source)) return;
      configured.add(source);
      const resourcePointer = `${pointer}/resources/${index}`;
      list(item.depends_on).forEach((value, i) => addReference(value, source, prefix, `${resourcePointer}/depends_on/${i}`));
      for (const [key, expression] of Object.entries(at(item.expressions) ?? {})) {
        if (!bounded(key) || !identifier.test(key)) continue;
        list(at(expression)?.references).forEach((value, i) => addReference(value, source, prefix, `${resourcePointer}/expressions/${token(key)}/references/${i}`));
      }
    });
    for (const [key, call] of Object.entries(at(module.module_calls) ?? {})) {
      const child = at(at(call)?.module);
      if (child && bounded(key) && identifier.test(key)) {
        configurationModule(child, `${prefix}module.${key}.`, `${pointer}/module_calls/${token(key)}/module`);
      }
    }
  }
  if (config) configurationModule(config, '', '/configuration/root_module');
  return { virtualPath, planned, hasConfiguration: !!config, unmatchedConfiguration: config ? addresses.size - configured.size : 0,
    resources, references, omitted, unresolved };
}
