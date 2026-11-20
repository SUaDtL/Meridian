import type { DiagramTemplate, StudioDocument, StudioSettings } from '../types';
import { DEFAULT_SETTINGS } from './themes';
import { TEMPLATES } from './templates';
import { createDesign, validateDesign } from './design';
import { validateStoryboard } from './storyboard';

export const STORAGE_KEY = 'meridian:v2';
export const LEGACY_STORAGE_KEY = 'meridian:v1';
const MAX_PROJECTS = 50;
const MAX_SOURCE = 100_000;
const MAX_WORKSPACE_BYTES = 8_000_000;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const DOCUMENT_KEYS = new Set(['schema', 'id', 'title', 'subtitle', 'source', 'settings', 'nodeAccents', 'design', 'storyboard', 'updatedAt']);
const SETTING_KEYS = new Set([
  'theme', 'layout', 'curve', 'spacing', 'finish', 'shadow', 'glow', 'motion',
  'speed', 'background', 'ambient', 'frame', 'font', 'edgeWidth', 'padding',
  'showTitle', 'showBrand',
]);

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function checkKeys(value: JsonRecord, allowed: Set<string>, label: string): void {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key) || !allowed.has(key)) {
      throw new Error(`${label} contains an unsupported field: ${key}.`);
    }
  }
}

function string(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  if (value.length > max) throw new Error(`${label} is longer than ${max.toLocaleString()} characters.`);
  if (required && !value.trim()) throw new Error(`${label} cannot be empty.`);
  return value;
}

function choice<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`${label} has an unsupported value.`);
  }
  return value as T;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false.`);
  return value;
}

function number(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

function validateSettings(value: unknown): StudioSettings {
  const s = record(value, 'Settings');
  checkKeys(s, SETTING_KEYS, 'Settings');
  return {
    theme: choice(s.theme, ['obsidian', 'porcelain', 'blueprint', 'ember', 'dusk', 'moss'], 'Theme'),
    layout: choice(s.layout, ['dagre', 'elk'], 'Layout'),
    curve: choice(s.curve, ['basis', 'linear', 'step'], 'Curve'),
    spacing: choice(s.spacing, ['compact', 'balanced', 'airy'], 'Spacing'),
    finish: choice(s.finish, ['solid', 'gradient'], 'Finish'),
    shadow: bool(s.shadow, 'Shadow'),
    glow: bool(s.glow, 'Glow'),
    motion: choice(s.motion, ['none', 'flow', 'pulse'], 'Motion'),
    speed: number(s.speed, 'Motion speed', 0.25, 3),
    background: choice(s.background, ['dots', 'grid', 'none'], 'Background'),
    ambient: bool(s.ambient, 'Ambient light'),
    frame: choice(s.frame, ['auto', '16:9', '4:3', '1:1'], 'Frame'),
    font: choice(s.font, ['sans', 'mono'], 'Font'),
    edgeWidth: number(s.edgeWidth, 'Line weight', 0.5, 6),
    padding: number(s.padding, 'Padding', 0, 240),
    showTitle: bool(s.showTitle, 'Show title'),
    showBrand: bool(s.showBrand, 'Show signature'),
  };
}

function validateDocument(value: unknown): StudioDocument {
  const doc = record(value, 'Project');
  checkKeys(doc, DOCUMENT_KEYS, 'Project');
  if (doc.schema !== 'meridian/v1' && doc.schema !== 'meridian/v2') {
    throw new Error('Unsupported project format. Open a Meridian version 1 or 2 project JSON file.');
  }
  const id = string(doc.id, 'Project ID', 120, true);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Project ID contains unsupported characters.');
  const updatedAt = string(doc.updatedAt, 'Updated date', 40, true);
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error('The project has an invalid updated date.');
  const rawAccents = record(doc.nodeAccents, 'Node accents');
  if (Object.keys(rawAccents).length > 1_000) throw new Error('A project can contain at most 1,000 node accents.');
  const nodeAccents: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, value] of Object.entries(rawAccents)) {
    if (FORBIDDEN_KEYS.has(key) || key.length > 200 || !key.trim()) {
      throw new Error('The project has an unsupported node accent ID.');
    }
    if (typeof value !== 'string' || !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
      throw new Error('Node accents must be hexadecimal colors such as #5eead4.');
    }
    nodeAccents[key] = value;
  }
  return {
    schema: 'meridian/v2',
    id,
    title: string(doc.title, 'Project title', 120),
    subtitle: string(doc.subtitle, 'Project subtitle', 240),
    source: string(doc.source, 'Mermaid source', MAX_SOURCE),
    settings: validateSettings(doc.settings),
    nodeAccents,
    design: doc.design === undefined && doc.schema === 'meridian/v1' ? createDesign() : validateDesign(doc.design),
    ...(doc.storyboard === undefined ? {} : { storyboard: validateStoryboard(doc.storyboard) }),
    updatedAt,
  };
}

function newId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `diagram-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createDocument(template?: DiagramTemplate): StudioDocument {
  const selected = template ?? TEMPLATES[0];
  return {
    schema: 'meridian/v2',
    id: newId(),
    title: selected?.title ?? 'Untitled diagram',
    subtitle: selected?.subtitle ?? '',
    source: selected?.source ?? 'flowchart LR\n  A[An idea] --> B[Something worth showing]',
    settings: { ...DEFAULT_SETTINGS, ...(selected ? { theme: selected.theme } : {}) },
    nodeAccents: {},
    design: createDesign(),
    updatedAt: new Date().toISOString(),
  };
}

export function parseProject(text: string): StudioDocument {
  if (text.length > 2_000_000) throw new Error('This project file is too large. Open a file smaller than 2 MB.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This is not valid JSON. Open a Meridian project file or import the diagram as .mmd text.');
  }
  return validateDocument(parsed);
}

export function loadWorkspace(): { documents: StudioDocument[]; activeId: string | null; warning?: string } {
  try {
    // Leave the old workspace untouched so the previous app can still open it.
    // Once v2 has saved, it always takes precedence over the legacy copy.
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw === null) return { documents: [], activeId: null };
    if (raw.length > MAX_WORKSPACE_BYTES) throw new Error('The stored workspace is larger than supported.');
    const workspace = record(JSON.parse(raw), 'Workspace');
    checkKeys(workspace, new Set(['version', 'documents', 'activeId']), 'Workspace');
    if (workspace.version !== 1 && workspace.version !== 2) throw new Error('This browser contains an unsupported workspace version.');
    if (!Array.isArray(workspace.documents) || workspace.documents.length > MAX_PROJECTS) {
      throw new Error('The stored project list is invalid.');
    }
    const documents = workspace.documents.map(validateDocument);
    if (new Set(documents.map(doc => doc.id)).size !== documents.length) {
      throw new Error('The stored project list contains duplicate IDs.');
    }
    if (workspace.activeId !== null && typeof workspace.activeId !== 'string') {
      throw new Error('The stored active project is invalid.');
    }
    const activeId = documents.some(doc => doc.id === workspace.activeId)
      ? workspace.activeId as string
      : documents[0]?.id ?? null;
    return { documents, activeId };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Browser storage is unavailable.';
    return {
      documents: [],
      activeId: null,
      warning: `Your browser workspace could not be loaded. ${detail} Import a saved project to recover your work.`,
    };
  }
}

export function saveWorkspace(documents: StudioDocument[], activeId: string): { ok: boolean; error?: string } {
  try {
    if (documents.length > MAX_PROJECTS) throw new Error(`Keep at most ${MAX_PROJECTS} projects in this browser.`);
    const checked = documents.map(validateDocument);
    if (new Set(checked.map(doc => doc.id)).size !== checked.length) throw new Error('Project IDs must be unique.');
    if (checked.length && !checked.some(doc => doc.id === activeId)) throw new Error('The active project does not exist.');
    const serialized = JSON.stringify({ version: 2, documents: checked, activeId: checked.length ? activeId : null });
    if (serialized.length > MAX_WORKSPACE_BYTES) throw new Error('The workspace is too large for browser storage. Export projects before removing any.');
    localStorage.setItem(STORAGE_KEY, serialized);
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error && error.name !== 'QuotaExceededError'
      ? error.message
      : 'Browser storage is full or unavailable.';
    return { ok: false, error: `${detail} Download a project file to keep your latest changes.` };
  }
}

export function downloadText(content: string, filename: string, type = 'application/json;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function safeFilename(title: string): string {
  return title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100).replace(/-+$/, '') || 'meridian-diagram';
}

export function normalizeSource(source: string): string {
  // A complete surrounding Mermaid fence is a transport wrapper, not diagram content.
  // Leave partial fences, other languages and multiple fenced blocks untouched.
  const match = source.match(/^\s*(`{3,}|~{3,})[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*(`{3,}|~{3,})[ \t]*\s*$/i);
  if (!match || match[1][0] !== match[3][0] || match[3].length < match[1].length) return source;
  const closing = new RegExp(`^[ \\t]*${match[1][0]}{${match[1].length},}[ \\t\\r]*$`, 'm');
  if (closing.test(match[2])) return source;
  return match[2];
}
