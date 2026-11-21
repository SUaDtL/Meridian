import { describe, expect, it } from 'vitest';
import { readTerraformFacts } from './terraform-facts';

const read = (body: string) => readTerraformFacts(new TextEncoder().encode(body).buffer, 'plan.json');

describe('Terraform inventory facts', () => {
  it('resolves declared attribute references within their module and omits raw values', () => {
    const resources = [{ address: 'module.app.aws_a.first', values: { secret: 'fixture-private-value' } }, { address: 'module.app.aws_b.second' }];
    const result = read(JSON.stringify({
      format_version: '1.2',
      planned_values: { root_module: { child_modules: [{ address: 'module.app', resources }] } },
      configuration: { root_module: { module_calls: { app: { module: { resources: [
        { address: 'aws_a.first', expressions: { endpoint: { references: ['aws_b.second.id', 'var.private'] }, password: { constant_value: 'fixture-private-value' } } },
        { address: 'aws_b.second' },
      ] } } } } },
    }));
    expect(result.planned).toBe(true);
    expect(result.resources.map(item => item.module)).toEqual(['module.app', 'module.app']);
    expect(result.references).toEqual([{
      source: 'module.app.aws_a.first', target: 'module.app.aws_b.second',
      pointer: '/configuration/root_module/module_calls/app/module/resources/0/expressions/endpoint/references/0',
    }]);
    expect(result.unresolved).toBe(1);
    expect(JSON.stringify(result)).not.toContain('fixture-private-value');
  });

  it('keeps state inventory separate from configuration and omits string index keys', () => {
    const result = read('{"format_version":"1.0","values":{"root_module":{"resources":[{"address":"aws_a.first"},{"address":"aws_b.second[\\"fixture-private-key\\"]"}]}}}');
    expect(result).toMatchObject({ planned: false, hasConfiguration: false, omitted: 1, references: [] });
    expect(result.resources.map(item => item.address)).toEqual(['aws_a.first']);
    expect(JSON.stringify(result)).not.toContain('fixture-private-key');
    expect(() => read('{"format_version":"2.0"}')).toThrow('format_version 1.x');
  });

  it('distinguishes numeric resource and module instances without deriving edges from a shared configuration', () => {
    const target = 'module.workers[0].module.compute[2].aws_worker.task[1]';
    const sibling = 'module.workers[0].module.compute[2].aws_worker.task[0]';
    const result = read(JSON.stringify({
      format_version: '1.2',
      planned_values: { root_module: { resources: [{ address: 'aws_job.launch' }], child_modules: [
        { address: 'module.workers[0]', child_modules: [
          { address: 'module.workers[0].module.compute[2]', resources: [{ address: target }, { address: sibling },
            { address: 'module.workers[0].module.compute[2].aws_worker.task["fixture-private-key"]' }] },
          { address: 'module.workers[1].module.compute[2]', resources: [{ address: 'aws_other.none' }] },
        ] },
      ] } },
      configuration: { root_module: { resources: [
        { address: 'aws_job.launch', depends_on: [target + '.id'] },
      ], module_calls: { workers: { module: { module_calls: { compute: { module: { resources: [
        { address: 'aws_worker.task', depends_on: ['aws_worker.task'] },
      ] } } } } } } } },
    }));
    expect(result.resources.map(item => item.address)).toEqual(['aws_job.launch', target, sibling]);
    expect(result.resources.slice(1).map(item => item.module)).toEqual(Array(2).fill('module.workers[0].module.compute[2]'));
    expect(result.references).toEqual([{ source: 'aws_job.launch', target, pointer: '/configuration/root_module/resources/0/depends_on/0' }]);
    expect(result).toMatchObject({ unmatchedConfiguration: 2, omitted: 2, unresolved: 0 });
    expect(JSON.stringify(result)).not.toContain('fixture-private-key');
  });
});
