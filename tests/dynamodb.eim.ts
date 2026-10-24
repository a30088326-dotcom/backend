import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memory } from './dynamodb.domain-memory';
import { withRepositoryForTests } from '../src/storage/repository';
import { StorageConflictError } from '../src/storage/dynamodb';
import * as eim from '../src/modules/eim/eim.dynamo.service';
import { db } from '../src/lib/db';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PROVIDER = 'dynamodb';
(db as any).query = async () => { throw new Error('Unexpected SQL'); };
(db as any).getConnection = async () => { throw new Error('Unexpected SQL connection'); };

test('all EIM resources create, edit, reload and delete through native storage with audit', async () => {
  const { repo } = memory();
  await withRepositoryForTests(repo, async () => {
    for (const resource of Object.keys(eim.resources)) {
      const body = resource === 'dynamic-fields'
        ? { fieldName: 'test_field', fieldLabel: 'Test field', fieldType: 'text', applicableModule: 'employee_information', options: ['One', 'Two'] }
        : { code: `test-${resource}`, name: `Test ${resource}`, description: 'Initial' };
      const { id } = await eim.save(resource, body, 'actor');
      let saved = (await eim.list(resource)).find(row => row.id === id)!;
      assert.ok(saved, resource);
      assert.equal(saved.isActive, 1);
      assert.equal(saved._version, undefined);
      await eim.save(resource, { ...body, description: 'Changed', isActive: false }, 'actor', id);
      saved = (await eim.list(resource)).find(row => row.id === id)!;
      assert.equal(saved.isActive, 0);
      await eim.save(resource, resource === 'dynamic-fields' ? { fieldLabel: 'Changed label' } : { name: 'Changed name' }, 'actor', id);
      assert.equal((await eim.list(resource)).find(row => row.id === id)!.isActive, 0, 'Partial edit must not reactivate a disabled record');
      await eim.remove(resource, id, 'actor');
      assert.equal((await eim.list(resource)).length, 0);
    }
    assert.equal((await eim.auditLogs()).length, 100);
  });
});

test('EIM mappings validate parents and preserve active dependent records', async () => {
  const { repo } = memory();
  await withRepositoryForTests(repo, async () => {
    await assert.rejects(eim.save('locations', { code: 'L', name: 'Location', companyId: 'missing' }, 'actor'), /no longer exists/);
    assert.equal((await eim.list('locations')).length, 0);
    const company = await eim.save('companies', { code: 'C', name: 'Company' }, 'actor');
    const location = await eim.save('locations', { code: 'L', name: 'Location', companyId: company.id }, 'actor');
    await assert.rejects(eim.remove('companies', company.id, 'actor'), /in use/);
    assert.ok(await repo.get('eim_companies', { id: company.id }));
    await eim.remove('locations', location.id, 'actor');
    await eim.remove('companies', company.id, 'actor');
    const type = await eim.save('employment-types', { code: 'P', name: 'Permanent' }, 'actor');
    await repo.create('employee_information_employees', { id: 'employee', employmentTypeId: type.id });
    await assert.rejects(eim.remove('employment-types', type.id, 'actor'), /in use/);
  });
});

test('EIM rejects parent cycles and case-insensitive duplicate codes atomically', async () => {
  const { repo } = memory();
  await withRepositoryForTests(repo, async () => {
    const first = await eim.save('structures', { code: 'ROOT', name: 'Root' }, 'actor');
    const second = await eim.save('structures', { code: 'CHILD', name: 'Child', parentId: first.id }, 'actor');
    await assert.rejects(eim.parent('structures', first.id, second.id, 'actor'), /Circular/);
    assert.equal((await repo.get('eim_structures', { id: first.id }))!.parentId, null);
    await assert.rejects(eim.save('structures', { code: 'root', name: 'Duplicate' }, 'actor'), StorageConflictError);
    assert.equal((await eim.list('structures')).length, 2);
  });
});

test('benefit grade links and zero amounts persist, JSON fields retain API object types', async () => {
  const { repo } = memory();
  await withRepositoryForTests(repo, async () => {
    const grade = await eim.save('salary-grades', { code: 'G', name: 'Grade', minSalary: 0, maxSalary: 100 }, 'actor');
    const benefit = await eim.save('benefits', { code: 'B', name: 'Benefit', defaultAmount: 0, eligibleSalaryGrades: [grade.id] }, 'actor');
    assert.deepEqual((await eim.list('benefits'))[0].eligibleSalaryGrades, [grade.id]);
    assert.equal((await eim.list('benefits'))[0].defaultAmount, 0);
    await assert.rejects(eim.remove('salary-grades', grade.id, 'actor'), /in use/);
    await eim.save('benefits', { eligibleSalaryGrades: [] }, 'actor', benefit.id);
    await eim.remove('salary-grades', grade.id, 'actor');
    const field = await eim.save('dynamic-fields', { fieldName: 'custom', fieldLabel: 'Custom', fieldType: 'select', applicableModule: 'employee_information', options: '["One","Two"]', validationRules: { maxLength: 20 } }, 'actor');
    const saved = (await eim.list('dynamic-fields')).find(row => row.id === field.id)!;
    assert.deepEqual(saved.options, ['One', 'Two']);
    assert.deepEqual(saved.validationRules, { maxLength: 20 });
    await assert.rejects(eim.save('dynamic-fields', { options: '{invalid' }, 'actor', field.id), /valid JSON/);
    assert.deepEqual((await eim.list('dynamic-fields'))[0].options, ['One', 'Two']);
  });
});
