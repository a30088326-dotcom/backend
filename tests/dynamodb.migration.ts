import { test } from 'node:test';
import assert from 'node:assert/strict';
import schemas from '../src/storage/entity-schemas.json';
import { DynamoStore } from '../src/storage/dynamodb';
import { uniqueGuards } from '../src/storage/repository';
import { applicationData, auditSnapshot, checksum, entityNames, importSnapshot, makeSnapshot, rowsChecksum, validateSnapshot } from '../src/storage/migration';
import type { EntityName } from '../src/storage/table-definitions';

function setup() {
  const tables = new Map<string, Map<string, any>>();
  let mutations = 0;
  const store = new DynamoStore({ async send(command: any) {
    const input = command.input;
    function table(name: string) {
      let records = tables.get(name);
      if (!records) { records = new Map(); tables.set(name, records); }
      return records;
    }
    function key(name: string, item: any) { return JSON.stringify(store.key(name.replace('test-', '') as EntityName, item)); }
    if (command.constructor.name === 'ScanCommand') return { Items: [...table(input.TableName).values()] };
    if (command.constructor.name === 'GetCommand') return { Item: table(input.TableName).get(JSON.stringify(input.Key)) };
    if (command.constructor.name === 'TransactWriteCommand') {
      for (const operation of input.TransactItems) {
        const put = operation.Put;
        if (put && table(put.TableName).has(key(put.TableName, put.Item))) throw new Error('Unexpected overwrite attempt');
        const check = operation.ConditionCheck;
        if (check && table(check.TableName).get(JSON.stringify(check.Key))?._version !== check.ExpressionAttributeValues[':version']) throw new Error('Version changed');
      }
      for (const operation of input.TransactItems) if (operation.Put) {
        const put = operation.Put;
        table(put.TableName).set(key(put.TableName, put.Item), structuredClone(put.Item));
        mutations++;
      }
      return {};
    }
    throw new Error(command.constructor.name);
  } } as any, 'test');
  const rows = Object.fromEntries(entityNames().map(entity => [entity, []])) as unknown as Record<EntityName, any[]>;
  const user = Object.fromEntries(Object.entries(schemas.users.columns).map(([column, schema]) => [column, schema.default === '__current_timestamp__' ? '2026-10-24 09:00:00' : schema.default]));
  Object.assign(user, { id: 'u1', email: 'one@example.com', name: 'Test user' });
  rows.users = [user];
  return { store, tables, rows, mutations: () => mutations, insert(entity: EntityName, item: any) {
    let table = tables.get(store.tableName(entity));
    if (!table) { table = new Map(); tables.set(store.tableName(entity), table); }
    table.set(JSON.stringify(store.key(entity, item)), structuredClone(item));
  } };
}

test('full 120-table snapshots verify checksums and refuse omitted tables or altered private values', () => {
  const { rows, store } = setup();
  const snapshot = makeSnapshot('hr_onboarding', rows, store);
  assert.equal(Object.keys(snapshot.tables).length, 120);
  assert.doesNotThrow(() => validateSnapshot(snapshot, store));
  snapshot.tables.users.rows[0].name = 'Altered';
  assert.throws(() => validateSnapshot(snapshot, store), /checksum/);
  const missing = { ...rows }; delete (missing as any).contracts;
  assert.throws(() => makeSnapshot('hr_onboarding', missing, store), /table list/);
});

test('migration adds row and uniqueness claim atomically and reruns without extra writes', async () => {
  const { rows, store, mutations } = setup();
  const snapshot = makeSnapshot('hr_onboarding', rows, store);
  const before = await auditSnapshot(snapshot, store);
  assert.equal(before.compatible, true);
  assert.equal(before.complete, false);
  assert.equal((await importSnapshot(snapshot, store)).complete, true);
  assert.equal(mutations(), 2);
  assert.equal((await importSnapshot(snapshot, store)).complete, true);
  assert.equal(mutations(), 2);
  const current = await store.get('users', { id: 'u1' });
  assert.equal(checksum(applicationData(current!)), checksum(rows.users[0]));
});

test('a conflicting cloud record blocks all migration writes and is never overwritten', async () => {
  const { rows, store, mutations, insert } = setup();
  insert('users', { ...rows.users[0], name: 'Existing cloud person', _version: 4 });
  const snapshot = makeSnapshot('hr_onboarding', rows, store);
  const audit = await auditSnapshot(snapshot, store);
  assert.equal(audit.compatible, false);
  await assert.rejects(importSnapshot(snapshot, store), /conflicts/);
  assert.equal(mutations(), 0);
  assert.equal((await store.get('users', { id: 'u1' }))!.name, 'Existing cloud person');
});

test('extra cloud records and unversioned records require reconciliation before cutover', async () => {
  for (const kind of ['extra', 'unversioned']) {
    const { rows, store, mutations, insert } = setup();
    insert('users', kind === 'extra' ? { ...rows.users[0], id: 'other', _version: 1 } : rows.users[0]);
    const snapshot = makeSnapshot('hr_onboarding', rows, store);
    await assert.rejects(importSnapshot(snapshot, store), /conflicts/);
    assert.equal(mutations(), 0);
  }
});

test('existing identical versioned record can receive missing claim without replacing its data', async () => {
  const { rows, store, mutations, insert } = setup();
  insert('users', { ...rows.users[0], _version: 5 });
  const snapshot = makeSnapshot('hr_onboarding', rows, store);
  assert.equal((await importSnapshot(snapshot, store)).complete, true);
  assert.equal(mutations(), 1);
  assert.equal((await store.get('users', { id: 'u1' }))!._version, 5);
});

test('a unique claim owned by a different cloud record blocks migration', async () => {
  const { rows, store, mutations, insert } = setup();
  const guard = uniqueGuards('users', rows.users[0], store)[0];
  insert('users', { ...guard, owner: { id: 'unrelated-person' }, _version: 1 });
  const snapshot = makeSnapshot('hr_onboarding', rows, store);
  await assert.rejects(importSnapshot(snapshot, store), /conflicts/);
  assert.equal(mutations(), 0);
});

test('orphan uniqueness claims block migration instead of reporting a complete database', async () => {
  const { rows, store, mutations, insert } = setup();
  const guard = uniqueGuards('users', { id: 'missing-user', email: 'orphan@example.com' }, store)[0];
  insert('users', { ...guard, _version: 1 });
  const snapshot = makeSnapshot('hr_onboarding', rows, store);
  const audit = await auditSnapshot(snapshot, store);
  assert.equal(audit.tables.find(t => t.entity === 'users')!.extraGuards, 1);
  await assert.rejects(importSnapshot(snapshot, store), /conflicts/);
  assert.equal(mutations(), 0);
});

test('snapshot validation refuses duplicate row keys even when all checksums were regenerated', () => {
  const { rows, store } = setup();
  const snapshot = makeSnapshot('hr_onboarding', rows, store);
  snapshot.tables.users.rows.push({ ...snapshot.tables.users.rows[0] });
  snapshot.tables.users.sha256 = rowsChecksum('users', snapshot.tables.users.rows, store);
  const { sha256: _old, ...body } = snapshot;
  snapshot.sha256 = checksum(body);
  assert.throws(() => validateSnapshot(snapshot, store), /Duplicate source primary key/);
});
