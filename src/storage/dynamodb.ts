import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand,
  ScanCommand, QueryCommand, TransactWriteCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import { tableDefinitions, type EntityName } from './table-definitions';

export type Document = Record<string, any>;
export type DocumentKey = Record<string, string | number>;
export type StoredDocument = Document & { _version: number };
type TableDefinition = { partitionKey: { name: string; type: string }; sortKey?: { name: string; type: string } };
type Sender = Pick<DynamoDBDocumentClient, 'send'>;
type TransactionItem = NonNullable<TransactWriteCommandInput['TransactItems']>[number];

export class StorageConflictError extends Error {
  constructor(message = 'This record changed. Reload it and try again.') { super(message); this.name = 'StorageConflictError'; }
}

/** Server-side only. Credentials come from the AWS runtime's IAM role. */
function defaultClient() {
  const region = process.env.AWS_REGION;
  if (!region) throw new Error('AWS_REGION must be configured for DynamoDB.');
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region, maxAttempts: 5 }), {
    marshallOptions: { removeUndefinedValues: true },
  });
}

export class DynamoStore {
  private readonly sender: Sender;
  constructor(sender?: Sender, private readonly prefix = process.env.DYNAMODB_TABLE_PREFIX || 'peoples-management') {
    if (!/^[a-zA-Z0-9_.-]+$/.test(prefix) || prefix.length > 170) throw new Error('Invalid DynamoDB table prefix.');
    this.sender = sender || defaultClient();
  }

  tableName(entity: EntityName) {
    if (!Object.prototype.hasOwnProperty.call(tableDefinitions, entity)) throw new Error(`Unknown entity: ${entity}`);
    return `${this.prefix}-${entity}`;
  }

  key(entity: EntityName, item: Document): DocumentKey {
    const definition: TableDefinition = tableDefinitions[entity];
    if (!definition) throw new Error(`Unknown entity: ${entity}`);
    return Object.fromEntries([definition.partitionKey, definition.sortKey].filter(Boolean).map(column => {
      const value = item[column!.name];
      if (column!.type === 'N' ? typeof value !== 'number' || !Number.isFinite(value) : typeof value !== 'string' || !value.length) {
        throw new Error(`Invalid DynamoDB key: ${entity}.${column!.name}`);
      }
      return [column!.name, value];
    }));
  }

  async get<T extends Document = Document>(entity: EntityName, key: DocumentKey): Promise<(T & { _version: number }) | undefined> {
    const result = await this.sender.send(new GetCommand({ TableName: this.tableName(entity), Key: this.key(entity, key), ConsistentRead: true }));
    return result.Item as (T & { _version: number }) | undefined;
  }

  createItem(entity: EntityName, item: Document): TransactionItem {
    this.key(entity, item);
    const definition: TableDefinition = tableDefinitions[entity];
    return { Put: { TableName: this.tableName(entity), Item: { ...item, _version: 1 },
      ConditionExpression: 'attribute_not_exists(#pk)', ExpressionAttributeNames: { '#pk': definition.partitionKey.name } } };
  }

  replaceItem(entity: EntityName, item: StoredDocument): TransactionItem {
    this.key(entity, item);
    this.validateVersion(item._version);
    return { Put: { TableName: this.tableName(entity), Item: { ...item, _version: item._version + 1 },
      ConditionExpression: '#version = :version', ExpressionAttributeNames: { '#version': '_version' },
      ExpressionAttributeValues: { ':version': item._version } } };
  }

  deleteItem(entity: EntityName, key: DocumentKey, version: number): TransactionItem {
    this.validateVersion(version);
    return { Delete: { TableName: this.tableName(entity), Key: this.key(entity, key),
      ConditionExpression: '#version = :version', ExpressionAttributeNames: { '#version': '_version' },
      ExpressionAttributeValues: { ':version': version } } };
  }

  private validateVersion(version: number) {
    if (!Number.isSafeInteger(version) || version < 1) throw new Error('A stored record version is required for changes.');
  }

  private conflict(error: unknown): never {
    if (error instanceof Error && (error.name === 'ConditionalCheckFailedException' ||
      (error.name === 'TransactionCanceledException' && (error as any).CancellationReasons?.some((reason: any) => reason.Code === 'ConditionalCheckFailed')))) {
      throw new StorageConflictError();
    }
    throw error;
  }

  async create<T extends Document>(entity: EntityName, item: T): Promise<T & { _version: number }> {
    try { await this.sender.send(new PutCommand(this.createItem(entity, item).Put!)); }
    catch (error) { this.conflict(error); }
    return { ...item, _version: 1 };
  }

  async replace<T extends StoredDocument>(entity: EntityName, item: T): Promise<T> {
    try { await this.sender.send(new PutCommand(this.replaceItem(entity, item).Put!)); }
    catch (error) { this.conflict(error); }
    return { ...item, _version: item._version + 1 };
  }

  async remove(entity: EntityName, key: DocumentKey, version: number): Promise<void> {
    try { await this.sender.send(new DeleteCommand(this.deleteItem(entity, key, version).Delete!)); }
    catch (error) { this.conflict(error); }
  }

  /** No chunking: a business transaction must commit atomically or fail. */
  async transact(items: TransactionItem[], token = randomUUID()): Promise<void> {
    if (items.length === 0) return;
    if (items.length > 100) throw new Error('A DynamoDB transaction can contain at most 100 record operations.');
    const addresses = items.map(item => {
      const operation = item.Put || item.Delete || item.Update || item.ConditionCheck;
      if (!operation) throw new Error('Invalid transaction operation.');
      const entity = Object.keys(tableDefinitions).find(name => this.tableName(name as EntityName) === operation.TableName) as EntityName | undefined;
      if (!entity) throw new Error('Transaction table is outside the application.');
      const key = this.key(entity, item.Put ? item.Put.Item! : (operation as any).Key);
      return `${operation.TableName}:${JSON.stringify(key)}`;
    });
    if (new Set(addresses).size !== addresses.length) throw new Error('A transaction cannot target the same record twice.');
    try { await this.sender.send(new TransactWriteCommand({ TransactItems: items, ClientRequestToken: token })); }
    catch (error) { this.conflict(error); }
  }

  async queryPartition<T extends Document = Document>(entity: EntityName, value: string | number): Promise<T[]> {
    const definition: TableDefinition = tableDefinitions[entity];
    if (!definition) throw new Error(`Unknown entity: ${entity}`);
    // Validate only the partition key; the sort key is intentionally unrestricted.
    const column = definition.partitionKey;
    if (column.type === 'N' ? typeof value !== 'number' || !Number.isFinite(value) : typeof value !== 'string' || !value) throw new Error('Invalid partition key.');
    const items: T[] = [];
    let next: DocumentKey | undefined;
    do {
      const result = await this.sender.send(new QueryCommand({ TableName: this.tableName(entity),
        KeyConditionExpression: '#pk = :pk', ExpressionAttributeNames: { '#pk': column.name },
        ExpressionAttributeValues: { ':pk': value }, ExclusiveStartKey: next, ConsistentRead: true }));
      items.push(...(result.Items || []) as T[]);
      next = result.LastEvaluatedKey as DocumentKey | undefined;
    } while (next);
    return items;
  }

  /** Administrative enumeration; request one page at a time instead of loading the whole database. */
  async page<T extends Document = Document>(entity: EntityName, options: { limit?: number; cursor?: DocumentKey } = {}) {
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Page size must be between 1 and 1000.');
    const result = await this.sender.send(new ScanCommand({ TableName: this.tableName(entity), Limit: limit,
      ExclusiveStartKey: options.cursor ? this.key(entity, options.cursor) : undefined, ConsistentRead: true }));
    return { items: (result.Items || []) as T[], cursor: result.LastEvaluatedKey as DocumentKey | undefined };
  }
}

let store: DynamoStore | undefined;
export function dynamoStore() { return store ||= new DynamoStore(); }
