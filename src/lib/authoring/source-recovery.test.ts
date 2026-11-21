import { expect, it } from 'vitest';
import fixture from './fixtures/example-project.json';
import { projectBaseToken } from './base-token';
import { readMatchingSourceRecovery, serializeSourceRecovery } from './source-recovery';
import { validateMermaidProject } from './validate-mermaid-project';

const project = validateMermaidProject(fixture);
const draft = '\uFEFFflowchart LR\r\n  A[\uD800 🧭]\r\n';

it('round-trips the exact accepted project, digest, and opaque source draft', async () => {
  const text = await serializeSourceRecovery(project, draft, 'annotation-limit');
  expect(JSON.parse(text)).toEqual({
    schema: 'meridian-recovery/v1', acceptedProject: project, sourceDraft: draft,
    baseStateDigest: (await projectBaseToken(project)).stateDigest, reason: 'annotation-limit',
  });
  await expect(readMatchingSourceRecovery(text, project)).resolves.toEqual({ sourceDraft: draft, reason: 'annotation-limit' });
});

it('rejects changed accepted metadata, another revision, and a forged embedded snapshot', async () => {
  const text = await serializeSourceRecovery(project, draft, 'annotation-limit');
  await expect(readMatchingSourceRecovery(text, { ...project, title: 'Different heading' })).rejects.toThrow('matching accepted project revision');
  await expect(readMatchingSourceRecovery(text, { ...project, revision: project.revision + 1 })).rejects.toThrow('matching accepted project revision');
  const recovery = JSON.parse(text);
  recovery.acceptedProject.title = 'Replaced in file';
  await expect(readMatchingSourceRecovery(JSON.stringify(recovery), project)).rejects.toThrow('does not match the accepted project it contains');
});

it('enforces the closed recovery fields, JSON keys, UTF-16 draft and byte budgets', async () => {
  const text = await serializeSourceRecovery(project, draft, 'project-size');
  await expect(readMatchingSourceRecovery(text.replace('{', '{"ignored":true,'), project)).rejects.toThrow('Meridian source recovery file');
  await expect(readMatchingSourceRecovery(text.replace('{', '{"schema":"meridian-recovery/v1",'), project)).rejects.toThrow('repeated object key');
  await expect(serializeSourceRecovery(project, '🧭'.repeat(50_001), 'project-size')).rejects.toThrow('100,000 UTF-16 code units');
  await expect(readMatchingSourceRecovery('é'.repeat(2_000_001), project)).rejects.toThrow('4,000,000 bytes');
});
