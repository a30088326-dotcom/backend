import { DynamoStore } from '../src/storage/dynamodb';
import { DynamoRepository } from '../src/storage/repository';
import { tableDefinitions } from '../src/storage/table-definitions';
export function memory() {
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
