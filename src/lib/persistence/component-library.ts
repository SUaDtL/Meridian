import { canonicalJson } from '../authoring/base-token';
import { maxComponentLibraryBytes, validateComponentDefinition, type ComponentDefinition } from '../authoring/component-definition';

const storeName = 'library';
const maxDefinitions = 200;
const encoder = new TextEncoder();

function verifyLibraryBytes(definitions: readonly ComponentDefinition[]) {
  const bytes = encoder.encode(JSON.stringify({ schema: 'meridian-library/v1', definitions })).byteLength;
  if (bytes > maxComponentLibraryBytes) throw new Error('The local library exceeds its 10,000,000-byte limit.');
}

export function readComponentLibrary(db: IDBDatabase): Promise<ComponentDefinition[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName);
    const read = tx.objectStore(storeName).getAll(undefined, maxDefinitions + 1);
    tx.onabort = () => reject(tx.error ?? new Error('The local component library could not be read.'));
    tx.oncomplete = () => {
      try {
        if (read.result.length > maxDefinitions) throw new Error('The local library exceeds its 200-definition limit.');
        resolve(read.result.map(validateComponentDefinition).sort((a, b) => a.name.localeCompare(b.name)));
      } catch (reason) { reject(reason); }
    };
  });
}

export type LibraryImport = { status: 'saved' | 'copied' | 'available'; definition: ComponentDefinition; bundled?: boolean };

export function saveComponentDefinitions(db: IDBDatabase, values: readonly ComponentDefinition[], bundled: readonly ComponentDefinition[]): Promise<LibraryImport[]> {
  if (values.length > maxDefinitions) throw new Error('A Meridian library file contains up to 200 component definitions.');
  const inputs = values.map(value => structuredClone(validateComponentDefinition(value)));
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const read = store.getAll(undefined, maxDefinitions + 1);
    const results: LibraryImport[] = [];
    let failure: unknown;
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('The component could not be saved to the library.'));
    tx.oncomplete = () => resolve(results);
    read.onsuccess = () => {
      try {
        const local = read.result.map(validateComponentDefinition);
        for (const input of inputs) {
          const signature = canonicalJson(input);
          const known = [...local, ...bundled].filter(candidate => candidate.id === input.id && candidate.version === input.version);
          const identical = known.find(candidate => canonicalJson(candidate) === signature);
          if (identical) {
            results.push({ status: 'available', definition: identical, bundled: bundled.includes(identical) });
            continue;
          }
          const definition = known.length ? { ...input, id: crypto.randomUUID() } : input;
          if (local.length >= maxDefinitions) throw new Error('The local library can contain at most 200 definitions.');
          local.push(definition);
          store.add(definition);
          results.push({ status: known.length ? 'copied' : 'saved', definition });
        }
        verifyLibraryBytes(local);
      } catch (reason) { failure = reason; tx.abort(); }
    };
  });
}

export function removeComponentDefinition(db: IDBDatabase, expected: ComponentDefinition): Promise<ComponentDefinition> {
  const definition = structuredClone(validateComponentDefinition(expected));
  const key = [definition.id, definition.version];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const read = store.get(key);
    let failure: unknown;
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('The component could not be removed.'));
    tx.oncomplete = () => resolve(definition);
    read.onsuccess = () => {
      try {
        if (!read.result || canonicalJson(validateComponentDefinition(read.result)) !== canonicalJson(definition)) {
          throw new Error('The component changed in another tab. Reopen the current library to review it.');
        }
        store.delete(key);
      } catch (reason) { failure = reason; tx.abort(); }
    };
  });
}

export function restoreComponentDefinition(db: IDBDatabase, removed: ComponentDefinition): Promise<ComponentDefinition> {
  const definition = structuredClone(validateComponentDefinition(removed));
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const read = store.getAll(undefined, maxDefinitions + 1);
    let failure: unknown;
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('The removed component could not be restored.'));
    tx.oncomplete = () => resolve(definition);
    read.onsuccess = () => {
      try {
        const local = read.result.map(validateComponentDefinition);
        const occupied = local.find(item => item.id === definition.id && item.version === definition.version);
        if (occupied) {
          if (canonicalJson(occupied) === canonicalJson(definition)) return;
          throw new Error('Another definition uses this ID and version. Download the removed definition to keep a copy.');
        }
        if (local.length >= maxDefinitions) throw new Error('The local library can contain at most 200 definitions.');
        verifyLibraryBytes([...local, definition]);
        store.add(definition);
      } catch (reason) { failure = reason; tx.abort(); }
    };
  });
}
