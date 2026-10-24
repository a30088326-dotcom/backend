import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import schemas from './entity-schemas.json';
import { DynamoStore, dynamoStore, StorageConflictError, type Document, type DocumentKey, type StoredDocument } from './dynamodb';
import { tableDefinitions, type EntityName } from './table-definitions';

export type Stored<T extends Document = Document> = T & { _version: number };
type Operation = ReturnType<DynamoStore['createItem']>;
const UNIQUE_PREFIX = '__pm_unique__:';
const MAX_ENUMERATION = 10000;
type Change = { entity: EntityName; key: DocumentKey; before?: StoredDocument; after?: StoredDocument };
export interface RepositorySession {
  get<T extends Document = Document>(entity: EntityName, key: DocumentKey): Promise<Stored<T> | undefined>;
  find<T extends Document = Document>(entity: EntityName, predicate: (item: Stored<T>) => boolean): Promise<Stored<T>[]>;
  create<T extends Document>(entity: EntityName, item: T): Promise<Stored<T>>;
  replace<T extends StoredDocument>(entity: EntityName, item: T): Promise<T>;
  remove(entity: EntityName, key: DocumentKey, version: number): Promise<void>;
}

export function storageNow() {
  // Match the source application's Colombo wall-clock DATETIME representation.
  return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 19).replace('T', ' ');
}

function identity(entity: EntityName, key: DocumentKey) {
  return `${entity}:${JSON.stringify(Object.entries(key).sort(([a], [b]) => a.localeCompare(b)))}`;
}

export function isApplicationDocument(item: Document) {
  return item._kind !== 'unique-constraint';
}

function normalizeUnique(value: unknown) {
  // Source schema uses case/accent insensitive UTF-8 collations. SQL NULLs do not claim uniqueness.
  return typeof value === 'string' ? value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ +$/, '') : value;
}

export function uniqueGuards(entity: EntityName, item: Document, store: DynamoStore): Document[] {
  const schema = schemas[entity];
  const claims: { columns: string[]; values: unknown[] }[] = schema.uniqueKeys.flatMap((columns: string[]) => {
    if (columns.some(column => item[column] === null || item[column] === undefined)) return [];
    return [{ columns, values: columns.map(column => normalizeUnique(item[column])) }];
  });
  // Pending invitations share an email aggregate even though their public IDs differ.
  // Acceptance, decline, expiry and deletion release this claim in the same transaction.
  if (entity === 'invites' && item.status === 'PENDING' && item.email != null) {
    claims.push({ columns: ['__pending_invite_email'], values: [normalizeUnique(item.email)] });
  }
  if (entity === 'employee_information_employees') {
    if (item.userId) claims.push({ columns: ['__employee_login'], values: [normalizeUnique(item.userId)] });
    const numbers = new Set([item.employeeNumber, item.employeeNo].filter(value => value != null && String(value).trim()).map(normalizeUnique));
    for (const number of numbers) claims.push({ columns: ['__employee_number'], values: [number] });
  }
  if (entity === 'leave_rule_scripts' && Number(item.isDefault) === 1) {
    claims.push({ columns: ['__default_leave_rule'], values: [true] });
  }
  if (entity === 'calendargroup' && Number(item.isCompanyCalendar) === 1) {
    claims.push({ columns: ['__company_calendar'], values: [true] });
  }
  if (entity === 'holidaycalendar' && item.year != null && item.calendarGroupId) {
    claims.push({ columns: ['year', 'calendarGroupId'], values: [Number(item.year), normalizeUnique(item.calendarGroupId)] });
  }
  return claims.map(({ columns, values }) => {
    const id = UNIQUE_PREFIX + createHash('sha256').update(JSON.stringify([columns, values])).digest('hex');
    const definition = tableDefinitions[entity];
    if (definition.partitionKey.type !== 'S' || 'sortKey' in definition) throw new Error(`Unsupported unique constraint key: ${entity}`);
    return { [definition.partitionKey.name]: id, _kind: 'unique-constraint', owner: store.key(entity, item), columns };
  });
}

function prepare(entity: EntityName, item: Document, update: boolean): StoredDocument {
  if (item._kind || Object.values(tableDefinitions[entity]).some(column => typeof item[column.name] === 'string' && item[column.name].startsWith(UNIQUE_PREFIX))) {
    throw new Error('Reserved storage metadata cannot be supplied as application data.');
  }
  const output: Document = { ...item };
  const now = storageNow();
  const schema = schemas[entity];
  for (const [name, column] of Object.entries(schema.columns)) {
    if (update && column.autoUpdate) output[name] = now;
    if (!update && output[name] === undefined) {
      const value = column.default;
      output[name] = value === '__current_timestamp__' ? now : value;
      if (typeof value === 'string' && /^(tinyint|smallint|mediumint|int|bigint|decimal|float|double)$/.test(column.type)) output[name] = Number(value);
    }
  }
  return output as StoredDocument;
}

/** Native DynamoDB unit of work. Read versions and all writes are checked in one atomic commit.
 * Enumeration is not a serializable predicate lock: reserve unique business keys in the schema,
 * or read a shared aggregate record before changing a collection. Never use find-then-create
 * to enforce an invariant which has no declared unique key.
 */
export class DynamoTransaction {
  private readonly reads = new Map<string, { entity: EntityName; key: DocumentKey; value?: StoredDocument }>();
  private readonly changes = new Map<string, Change>();
  private finished = false;
  constructor(private readonly repo: DynamoRepository) {}

  private open() { if (this.finished) throw new Error('This storage transaction has already completed.'); }

  async get<T extends Document = Document>(entity: EntityName, key: DocumentKey): Promise<Stored<T> | undefined> {
    this.open();
    const normalized = this.repo.store.key(entity, key);
    const address = identity(entity, normalized);
    const change = this.changes.get(address);
    if (change) return change.after ? structuredClone(change.after) as Stored<T> : undefined;
    let read = this.reads.get(address);
    if (!read) {
      const value = await this.repo.store.get(entity, normalized);
      if (value && !isApplicationDocument(value)) throw new Error('Reserved storage key.');
      read = { entity, key: normalized, value };
      this.reads.set(address, read);
    }
    return read.value ? structuredClone(read.value) as Stored<T> : undefined;
  }

  async find<T extends Document = Document>(entity: EntityName, predicate: (item: Stored<T>) => boolean): Promise<Stored<T>[]> {
    this.open();
    const items = await this.repo.find<T>(entity, predicate);
    const found = new Map<string, Stored<T>>();
    for (const item of items) {
      const key = this.repo.store.key(entity, item);
      const address = identity(entity, key);
      if (!this.reads.has(address)) this.reads.set(address, { entity, key, value: item });
      found.set(address, item);
    }
    for (const [address, change] of this.changes) {
      if (change.entity !== entity) continue;
      if (change.after && predicate(change.after as Stored<T>)) found.set(address, change.after as Stored<T>);
      else found.delete(address);
    }
    return Array.from(found.values(), item => structuredClone(item));
  }

  async create<T extends Document>(entity: EntityName, item: T): Promise<Stored<T>> {
    const key = this.repo.store.key(entity, item);
    const current = await this.get(entity, key);
    if (current) throw new StorageConflictError(`Record already exists in ${entity}.`);
    const after = { ...prepare(entity, item, false), _version: 1 };
    const address = identity(entity, key);
    const before = this.reads.get(address)?.value;
    this.changes.set(address, { entity, key, before, after });
    return structuredClone(after) as Stored<T>;
  }

  async replace<T extends StoredDocument>(entity: EntityName, item: T): Promise<T> {
    const key = this.repo.store.key(entity, item);
    const current = await this.get(entity, key);
    if (!current || current._version !== item._version) throw new StorageConflictError('A current stored record version is required for replacement.');
    const address = identity(entity, key);
    const before = this.changes.get(address)?.before ?? this.reads.get(address)?.value;
    const after = { ...prepare(entity, item, true), _version: item._version + 1 };
    this.changes.set(address, { entity, key, before, after });
    return structuredClone(after) as T;
  }

  async remove(entity: EntityName, key: DocumentKey, version: number): Promise<void> {
    const current = await this.get(entity, key);
    if (!current || current._version !== version) throw new StorageConflictError('A current stored record version is required for deletion.');
    const normalized = this.repo.store.key(entity, key);
    const address = identity(entity, normalized);
    this.changes.set(address, { entity, key: normalized, before: this.changes.get(address)?.before ?? this.reads.get(address)?.value });
  }

  async commit() {
    this.open();
    this.finished = true;
    if (!this.changes.size) return;
    const operations: Operation[] = [];
    const priorClaims = new Map<string, { entity: EntityName; guard: Document }>();
    const nextClaims = new Map<string, { entity: EntityName; guard: Document }>();
    for (const [address, read] of this.reads) {
      if (this.changes.has(address)) continue;
      operations.push({ ConditionCheck: { TableName: this.repo.store.tableName(read.entity), Key: read.key,
        ConditionExpression: read.value ? '#version = :version' : 'attribute_not_exists(#pk)',
        ExpressionAttributeNames: read.value ? { '#version': '_version' } : { '#pk': tableDefinitions[read.entity].partitionKey.name },
        ...(read.value ? { ExpressionAttributeValues: { ':version': read.value._version } } : {}) } });
    }
    for (const change of this.changes.values()) {
      const { entity, before, after, key } = change;
      if (!before && !after) continue;
      if (!before) {
        const operation = this.repo.store.createItem(entity, after!);
        operation.Put!.Item = after!;
        operations.push(operation);
      }
      else if (!after) operations.push(this.repo.store.deleteItem(entity, key, before._version));
      else {
        const operation = this.repo.store.replaceItem(entity, { ...after, _version: before._version });
        operation.Put!.Item = after;
        operations.push(operation);
      }
      for (const guard of before ? uniqueGuards(entity, before, this.repo.store) : []) {
        priorClaims.set(identity(entity, this.repo.store.key(entity, guard)), { entity, guard });
      }
      for (const guard of after ? uniqueGuards(entity, after, this.repo.store) : []) {
        const address = identity(entity, this.repo.store.key(entity, guard));
        const claimed = nextClaims.get(address);
        if (claimed && identity(entity, claimed.guard.owner) !== identity(entity, guard.owner)) throw new StorageConflictError('Two records claim the same unique value.');
        nextClaims.set(address, { entity, guard });
      }
    }
    for (const address of new Set([...priorClaims.keys(), ...nextClaims.keys()])) {
      const before = priorClaims.get(address), after = nextClaims.get(address);
      if (before && after && identity(before.entity, before.guard.owner) === identity(after.entity, after.guard.owner)) continue;
      if (!before && after) operations.push(this.repo.store.createItem(after.entity, after.guard));
      else if (before && !after) operations.push({ Delete: { TableName: this.repo.store.tableName(before.entity), Key: this.repo.store.key(before.entity, before.guard),
        ConditionExpression: '#owner = :owner', ExpressionAttributeNames: { '#owner': 'owner' }, ExpressionAttributeValues: { ':owner': before.guard.owner } } });
      else if (before && after) {
        const operation = this.repo.store.createItem(after.entity, after.guard);
        operation.Put!.ConditionExpression = '#owner = :owner';
        operation.Put!.ExpressionAttributeNames = { '#owner': 'owner' };
        operation.Put!.ExpressionAttributeValues = { ':owner': before.guard.owner };
        operations.push(operation);
      }
    }
    await this.repo.store.transact(operations);
  }
}

export class DynamoRepository {
  constructor(readonly store = dynamoStore(), private readonly maxEnumeration = MAX_ENUMERATION) {}
  async get<T extends Document = Document>(entity: EntityName, key: DocumentKey): Promise<Stored<T> | undefined> {
    const item = await this.store.get<T>(entity, key);
    if (item && !isApplicationDocument(item)) return undefined;
    return item;
  }
  async list<T extends Document = Document>(entity: EntityName, options: { limit?: number; cursor?: DocumentKey } = {}) {
    const page = await this.store.page<Stored<T>>(entity, options);
    return { items: page.items.filter(isApplicationDocument), cursor: page.cursor };
  }
  async find<T extends Document = Document>(entity: EntityName, predicate: (item: Stored<T>) => boolean): Promise<Stored<T>[]> {
    const result: Stored<T>[] = [];
    let cursor: DocumentKey | undefined;
    let read = 0;
    do {
      const page = await this.store.page<Stored<T>>(entity, { limit: 500, cursor });
      read += page.items.length;
      if (read > this.maxEnumeration) throw new Error(`Enumeration limit exceeded for ${entity}; add an indexed access pattern.`);
      result.push(...page.items.filter(isApplicationDocument).filter(predicate));
      cursor = page.cursor;
    } while (cursor);
    return result;
  }
  async transaction<T>(work: (tx: DynamoTransaction) => Promise<T>): Promise<T> {
    const tx = new DynamoTransaction(this);
    const value = await work(tx);
    await tx.commit();
    return value;
  }
  create<T extends Document>(entity: EntityName, item: T) { return this.transaction(tx => tx.create(entity, item)); }
  replace<T extends StoredDocument>(entity: EntityName, item: T) { return this.transaction(tx => tx.replace(entity, item)); }
  remove(entity: EntityName, key: DocumentKey, version: number) { return this.transaction(tx => tx.remove(entity, key, version)); }
}

let singleton: DynamoRepository | undefined;
const testRepositories = new AsyncLocalStorage<DynamoRepository>();
export function repository() { return testRepositories.getStore() || (singleton ||= new DynamoRepository()); }
/** Scoped injection avoids cross-test global client races. Unavailable in deployed processes. */
export function withRepositoryForTests<T>(repo: DynamoRepository, work: () => Promise<T>): Promise<T> {
  if (process.env.NODE_ENV !== 'test') throw new Error('Repository test injection requires NODE_ENV=test.');
  return testRepositories.run(repo, work);
}
