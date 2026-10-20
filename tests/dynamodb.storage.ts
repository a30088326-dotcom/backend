import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DynamoStore, StorageConflictError } from '../src/storage/dynamodb';

function setup(responses: any[] = []) {
  const calls: any[] = [];
  const sender = { async send(command: any) {
    calls.push(command);
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response || {};
  } };
  return { store: new DynamoStore(sender as any, 'test-peoples'), calls };
}

test('all entity keys retain their original key shape and numeric key types', () => {
  const { store } = setup();
  assert.deepEqual(store.key('users', { id: 'u1', email: 'one@example.com' }), { id: 'u1' });
  assert.deepEqual(store.key('hr_assistant_field_values', { field_id: 'f1', employee_id: 'e1' }), { field_id: 'f1', employee_id: 'e1' });
  assert.deepEqual(store.key('reporting_hierarchy_levels', { depth: 0 }), { depth: 0 });
  assert.throws(() => store.key('reporting_hierarchy_levels', { depth: '0' }));
  assert.throws(() => store.key('hr_assistant_field_values', { field_id: 'f1' }));
  assert.throws(() => store.tableName('__proto__' as any));
});

test('partition reads continue after an empty page with a continuation key', async () => {
  const { store, calls } = setup([
    { Items: [], LastEvaluatedKey: { field_id: 'f1', employee_id: 'e1' } },
    { Items: [{ field_id: 'f1', employee_id: 'e2', value: 'yes' }] },
  ]);
  assert.equal((await store.queryPartition('hr_assistant_field_values', 'f1')).length, 1);
  assert.deepEqual(calls[1].input.ExclusiveStartKey, { field_id: 'f1', employee_id: 'e1' });
  assert(calls.every(command => command.input.ConsistentRead === true));
});

test('administrative listing returns the next cursor without silently omitting later records', async () => {
  const cursor = { id: 'u1' };
  const { store, calls } = setup([{ Items: [{ id: 'u1' }], LastEvaluatedKey: cursor }]);
  const page = await store.page('users', { limit: 1 });
  assert.deepEqual(page.cursor, cursor);
  assert.equal(calls[0].input.Limit, 1);
  await assert.rejects(store.page('users', { limit: 0 }));
});

test('creation cannot overwrite an existing record and changes require its known version', async () => {
  const conflict = Object.assign(new Error('changed'), { name: 'ConditionalCheckFailedException' });
  const { store, calls } = setup([{}, conflict]);
  assert.deepEqual(await store.create('users', { id: 'u1' }), { id: 'u1', _version: 1 });
  assert.equal(calls[0].input.ConditionExpression, 'attribute_not_exists(#pk)');
  await assert.rejects(store.replace('users', { id: 'u1', _version: 1 }), StorageConflictError);
  assert.equal(calls[1].input.Item._version, 2);
  assert.equal(calls[1].input.ExpressionAttributeValues[':version'], 1);
  await assert.rejects(store.remove('users', { id: 'u1' }, 0));
});

test('transactions preserve atomicity and reject duplicate records, oversized batches and outside tables', async () => {
  const { store, calls } = setup();
  const one = store.createItem('users', { id: 'u1' });
  await assert.rejects(store.transact([one, one]), /same record twice/);
  await assert.rejects(store.transact(Array.from({ length: 101 }, (_, i) => store.createItem('users', { id: `u${i}` }))), /100/);
  await assert.rejects(store.transact([{ Put: { TableName: 'other-application', Item: { id: 'u1' } } }]), /outside/);
  assert.equal(calls.length, 0);
  await store.transact([one, store.createItem('user_module_permissions', { id: 'p1', userId: 'u1' })], 'create-user-001');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.TransactItems.length, 2);
  assert.equal(calls[0].input.ClientRequestToken, 'create-user-001');
});

test('transaction failures retain service errors except for actual record conflicts', async () => {
  const throttle = Object.assign(new Error('retry later'), { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ThrottlingError' }] });
  const conflict = Object.assign(new Error('changed'), { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] });
  const { store } = setup([throttle, conflict]);
  const item = store.createItem('users', { id: 'u1' });
  await assert.rejects(store.transact([item]), error => error === throttle);
  await assert.rejects(store.transact([item]), StorageConflictError);
});
