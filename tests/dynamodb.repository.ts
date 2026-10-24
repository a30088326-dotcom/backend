import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DynamoStore, StorageConflictError } from '../src/storage/dynamodb';
import { DynamoRepository, uniqueGuards } from '../src/storage/repository';
import { tableDefinitions } from '../src/storage/table-definitions';
import schemas from '../src/storage/entity-schemas.json';

function memory() {
  const records = new Map<string, any>();
  const calls: any[] = [];
  const store = new DynamoStore({ async send(command: any) {
    calls.push(command);
    const input = command.input;
    const address = (table: string, key: any) => `${table}:${JSON.stringify(key)}`;
    const key = (table: string, item: any) => {
      const entity = table.replace(/^test-/, '') as keyof typeof tableDefinitions;
      return store.key(entity, item);
    };
    if (command.constructor.name === 'GetCommand') return { Item: structuredClone(records.get(address(input.TableName, input.Key))) };
    if (command.constructor.name === 'ScanCommand') return { Items: [...records.entries()].filter(([id]) => id.startsWith(`${input.TableName}:`)).map(([, item]) => structuredClone(item)) };
    if (command.constructor.name === 'TransactWriteCommand') {
      for (const op of input.TransactItems) {
        const value = op.Put || op.Delete || op.ConditionCheck;
        const itemKey = op.Put ? key(value.TableName, value.Item) : value.Key;
        const current = records.get(address(value.TableName, itemKey));
        let valid = true;
        if (value.ConditionExpression === 'attribute_not_exists(#pk)') valid = !current;
        if (value.ConditionExpression === '#version = :version') valid = current?._version === value.ExpressionAttributeValues[':version'];
        if (value.ConditionExpression === '#owner = :owner') valid = JSON.stringify(current?.owner) === JSON.stringify(value.ExpressionAttributeValues[':owner']);
        if (!valid) throw Object.assign(new Error('conflict'), { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] });
      }
      for (const op of input.TransactItems) {
        if (op.Put) records.set(address(op.Put.TableName, key(op.Put.TableName, op.Put.Item)), structuredClone(op.Put.Item));
        if (op.Delete) records.delete(address(op.Delete.TableName, op.Delete.Key));
      }
      return {};
    }
    throw new Error(command.constructor.name);
  } } as any, 'test');
  return { records, calls, store, repo: new DynamoRepository(store) };
}

test('120 physical entity tables retain compatible schema and unique guard key shapes', () => {
  const { store } = memory();
  assert.equal(Object.keys(tableDefinitions).length, 120);
  assert.deepEqual(Object.keys(tableDefinitions).sort(), Object.keys(schemas).sort());
  for (const entity of Object.keys(tableDefinitions) as (keyof typeof tableDefinitions)[]) {
    const item = Object.fromEntries(Object.keys(schemas[entity].columns).map(column => [column, 'value']));
    const definition = tableDefinitions[entity];
    item[definition.partitionKey.name] = definition.partitionKey.type === 'N' ? 0 as any : 'record';
    for (const guard of uniqueGuards(entity, item, store)) assert.doesNotThrow(() => store.key(entity, guard));
  }
});

test('schema defaults and version are persisted; private uniqueness records never leak in listing', async () => {
  const { repo, records } = memory();
  const user = await repo.create('users', { id: 'u1', email: 'one@example.com' });
  assert.equal(user._version, 1);
  assert.equal(user.role, 'CANDIDATE');
  assert.equal(user.isActive, 1);
  assert.equal(records.size, 2);
  assert.equal((await repo.find('users', () => true)).length, 1);
  assert.equal((await repo.list('users')).items.length, 1);
});

test('unique email claims reject concurrent inserts, case/accent changes and trailing spaces atomically', async () => {
  const { repo, records } = memory();
  await repo.create('users', { id: 'u1', email: 'Tést@example.com' });
  await assert.rejects(repo.create('users', { id: 'u2', email: 'TEST@example.com ' }), StorageConflictError);
  assert.equal(await repo.get('users', { id: 'u2' }), undefined);
  assert.equal(records.size, 2);
});

test('renaming a unique field releases old claim and reserves new claim in the same commit', async () => {
  const { repo } = memory();
  const first = await repo.create('users', { id: 'u1', email: 'one@example.com' });
  await repo.replace('users', { ...first, email: 'two@example.com' });
  await repo.create('users', { id: 'u2', email: 'one@example.com' });
  await assert.rejects(repo.create('users', { id: 'u3', email: 'two@example.com' }), StorageConflictError);
  const changed = await repo.get('users', { id: 'u1' });
  await repo.remove('users', { id: 'u1' }, changed!._version);
  await repo.create('users', { id: 'u3', email: 'two@example.com' });
});

test('one pending invitation per normalized email is enforced atomically and released by status transition', async () => {
  const { repo } = memory();
  const first = await repo.create('invites', { id: 'invite-one', token: 'token-one', email: 'Tést@example.com', status: 'PENDING' });
  await assert.rejects(repo.create('invites', { id: 'invite-two', token: 'token-two', email: 'TEST@example.com ', status: 'PENDING' }), StorageConflictError);
  assert.equal(await repo.get('invites', { id: 'invite-two' }), undefined);
  await repo.replace('invites', { ...first, status: 'DECLINED' });
  await repo.create('invites', { id: 'invite-two', token: 'token-two', email: 'test@example.com', status: 'PENDING' });
  assert.equal((await repo.find('invites', () => true)).length, 2);
});

test('employee login and number aliases cannot be assigned to two profiles concurrently', async () => {
  const { repo } = memory();
  await repo.create('employee_information_employees', { id: 'employee-one', userId: 'login-one', employeeNo: 'EMP-000001', employeeNumber: 'EMP-000001' });
  await assert.rejects(repo.create('employee_information_employees', { id: 'employee-two', userId: 'login-one', employeeNo: 'EMP-000002' }), StorageConflictError);
  await assert.rejects(repo.create('employee_information_employees', { id: 'employee-three', userId: 'login-three', employeeNumber: 'emp-000001' }), StorageConflictError);
  assert.equal((await repo.find('employee_information_employees', () => true)).length, 1);
});

test('switching the single default leave rule transfers its claim in one atomic write', async () => {
  const { repo, calls } = memory();
  const first = await repo.create('leave_rule_scripts', { id: 'rule-one', name: 'First', isDefault: 1 });
  const second = await repo.create('leave_rule_scripts', { id: 'rule-two', name: 'Second', isDefault: 0 });
  await assert.rejects(repo.create('leave_rule_scripts', { id: 'rule-three', name: 'Third', isDefault: 1 }), StorageConflictError);
  await repo.transaction(async tx => {
    await tx.replace('leave_rule_scripts', { ...first, isDefault: 0 });
    await tx.replace('leave_rule_scripts', { ...second, isDefault: 1 });
  });
  assert.equal((await repo.get('leave_rule_scripts', { id: 'rule-one' }))!.isDefault, 0);
  assert.equal((await repo.get('leave_rule_scripts', { id: 'rule-two' }))!.isDefault, 1);
  const transaction = calls.filter(c => c.constructor.name === 'TransactWriteCommand').at(-1).input.TransactItems;
  assert.equal(transaction.filter((op: any) => op.Put?.Item?._kind === 'unique-constraint').length, 1);
});

test('two new records cannot claim the same unique value within one transaction', async () => {
  const { repo, records } = memory();
  await assert.rejects(repo.transaction(async tx => {
    await tx.create('users', { id: 'one', email: 'same@example.com' });
    await tx.create('users', { id: 'two', email: 'SAME@example.com' });
  }), StorageConflictError);
  assert.equal(records.size, 0);
});

test('transaction reads staged changes; repeated replacement stores returned version exactly', async () => {
  const { repo } = memory();
  const result = await repo.transaction(async tx => {
    const first = await tx.create('users', { id: 'u1', email: 'one@example.com' });
    const second = await tx.replace('users', { ...first, name: 'One' });
    assert.equal((await tx.find('users', item => item.name === 'One')).length, 1);
    return tx.replace('users', { ...second, name: 'Final' });
  });
  assert.equal(result._version, 3);
  assert.equal((await repo.get('users', { id: 'u1' }))!._version, result._version);
});

test('read dependency changes abort all staged writes instead of losing another request changes', async () => {
  const { repo } = memory();
  const user = await repo.create('users', { id: 'u1', email: 'one@example.com' });
  await assert.rejects(repo.transaction(async tx => {
    await tx.get('users', { id: 'u1' });
    await tx.create('users', { id: 'u2', email: 'two@example.com' });
    await repo.replace('users', { ...user, name: 'Other request' });
  }), StorageConflictError);
  assert.equal(await repo.get('users', { id: 'u2' }), undefined);
});

test('missing-read dependency is protected; no partial commit after a racing creation', async () => {
  const { repo } = memory();
  await assert.rejects(repo.transaction(async tx => {
    assert.equal(await tx.get('users', { id: 'u1' }), undefined);
    await tx.create('reporting_hierarchy_levels', { depth: 0, name: 'Root' });
    await repo.create('users', { id: 'u1', email: 'one@example.com' });
  }), StorageConflictError);
  assert.equal(await repo.get('reporting_hierarchy_levels', { depth: 0 }), undefined);
});

test('oversized business transactions fail without chunking or committing any records', async () => {
  const { repo, records } = memory();
  await assert.rejects(repo.transaction(async tx => {
    for (let i = 0; i < 51; i++) await tx.create('users', { id: `u${i}`, email: `u${i}@example.com` });
  }), /100/);
  assert.equal(records.size, 0);
});

test('reserved guard IDs and metadata are not writable application records', async () => {
  const { repo } = memory();
  await assert.rejects(repo.create('users', { id: '__pm_unique__:bad', email: 'one@example.com' }), /Reserved/);
  await assert.rejects(repo.create('users', { id: 'u1', _kind: 'unique-constraint' }), /Reserved/);
});

test('enumeration does not silently truncate on scan limit and follows empty continuation pages', async () => {
  const pages = [
    { Items: [], LastEvaluatedKey: { id: 'u0' } },
    { Items: [{ id: 'u1', _version: 1 }], LastEvaluatedKey: { id: 'u1' } },
    { Items: [{ id: 'u2', _version: 1 }] },
  ];
  const calls: any[] = [];
  const store = new DynamoStore({ async send(command: any) { calls.push(command); return pages.shift(); } } as any, 'test');
  await assert.rejects(new DynamoRepository(store, 1).find('users', () => true), /Enumeration limit/);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].input.ExclusiveStartKey, { id: 'u0' });
});
