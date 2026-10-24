import { createHash } from 'node:crypto';
import schemas from './entity-schemas.json';
import { tableDefinitions, type EntityName } from './table-definitions';
import { DynamoStore, type Document, type DocumentKey } from './dynamodb';
import { isApplicationDocument, uniqueGuards } from './repository';

export type MigrationSnapshot = {
  formatVersion: 1;
  createdAt: string;
  source: { engine: 'mysql'; schema: string; readOnly: true };
  tables: Record<EntityName, { rows: Document[]; sha256: string }>;
  sha256: string;
};

export function canonical(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Only plain migration objects are supported.');
    return `{${Object.entries(value as Document).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite migration number.');
  if (!['string', 'boolean', 'number'].includes(typeof value)) throw new Error(`Unsupported migration value: ${typeof value}`);
  return JSON.stringify(value);
}

export function checksum(value: unknown) { return createHash('sha256').update(canonical(value)).digest('hex'); }
export function entityNames() { return Object.keys(tableDefinitions).sort() as EntityName[]; }

export function applicationData(item: Document): Document {
  return Object.fromEntries(Object.entries(item).filter(([key]) => !['_version', '_migration'].includes(key)));
}

export function rowsChecksum(entity: EntityName, rows: Document[], store: DynamoStore) {
  const sorted = rows.map(row => ({ key: canonical(store.key(entity, row)), row: applicationData(row) })).sort((a, b) => a.key.localeCompare(b.key));
  return checksum(sorted);
}

function validateSourceRows(entity: EntityName, rows: Document[], store: DynamoStore) {
  const keys = new Set<string>(), guards = new Set<string>();
  for (const row of rows) {
    if (canonical(Object.keys(row).sort()) !== canonical(Object.keys(schemas[entity].columns).sort())) throw new Error(`Schema columns differ for ${entity}; regenerate and review the source manifest first.`);
    const recordKey = store.key(entity, row);
    if (Object.values(recordKey).some(value => typeof value === 'string' && value.startsWith('__pm_unique__:'))) throw new Error(`Reserved source primary key: ${entity}`);
    const key = canonical(recordKey);
    if (keys.has(key)) throw new Error(`Duplicate source primary key: ${entity}`);
    keys.add(key);
    canonical(row);
    for (const guard of uniqueGuards(entity, row, store)) {
      const uniqueKey = canonical(store.key(entity, guard));
      if (guards.has(uniqueKey)) throw new Error(`Duplicate source unique constraint: ${entity}`);
      guards.add(uniqueKey);
    }
  }
}

export function makeSnapshot(sourceSchema: string, sourceRows: Record<EntityName, Document[]>, store: DynamoStore): MigrationSnapshot {
  if (!sourceSchema || !/^[\w-]+$/.test(sourceSchema)) throw new Error('Invalid source schema name.');
  if (canonical(Object.keys(sourceRows).sort()) !== canonical(entityNames())) throw new Error('Source table list must exactly match all application tables.');
  const tables = Object.fromEntries(entityNames().map(entity => {
    const rows = sourceRows[entity];
    validateSourceRows(entity, rows, store);
    return [entity, { rows, sha256: rowsChecksum(entity, rows, store) }];
  })) as MigrationSnapshot['tables'];
  const body = { formatVersion: 1 as const, createdAt: new Date().toISOString(), source: { engine: 'mysql' as const, schema: sourceSchema, readOnly: true as const }, tables };
  return { ...body, sha256: checksum(body) };
}

export function validateSnapshot(snapshot: MigrationSnapshot, store: DynamoStore) {
  if (!snapshot || snapshot.formatVersion !== 1 || snapshot.source?.engine !== 'mysql' || snapshot.source.readOnly !== true) throw new Error('Unsupported migration snapshot.');
  const { sha256, ...body } = snapshot;
  if (sha256 !== checksum(body)) throw new Error('Snapshot checksum mismatch.');
  if (!/^[\w-]+$/.test(snapshot.source.schema)) throw new Error('Invalid source schema name.');
  if (canonical(Object.keys(snapshot.tables).sort()) !== canonical(entityNames())) throw new Error('Snapshot must contain every application table exactly once.');
  for (const entity of entityNames()) {
    const table = snapshot.tables[entity];
    if (!Array.isArray(table.rows) || rowsChecksum(entity, table.rows, store) !== table.sha256) throw new Error(`Snapshot table checksum mismatch: ${entity}`);
    validateSourceRows(entity, table.rows, store);
  }
}

type Difference = { entity: EntityName; sourceRows: number; cloudRows: number; identical: number; missing: number; different: number; extra: number; unversioned: number; missingGuards: number; conflictingGuards: number; extraGuards: number };
export type MigrationAudit = { snapshotSha256: string; at: string; tables: Difference[]; compatible: boolean; complete: boolean };

export async function cloudRows(store: DynamoStore, entity: EntityName) {
  const result: Document[] = [];
  let cursor: DocumentKey | undefined;
  do {
    const page = await store.page(entity, { limit: 500, cursor });
    result.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return result;
}

/** Read-only full comparison. Existing unrelated/different records block all imports. */
export async function auditSnapshot(snapshot: MigrationSnapshot, store: DynamoStore): Promise<MigrationAudit> {
  validateSnapshot(snapshot, store);
  const tables: Difference[] = [];
  for (const entity of entityNames()) {
    const all = await cloudRows(store, entity);
    const existing = new Map(all.filter(isApplicationDocument).map(row => [canonical(store.key(entity, row)), row]));
    const guards = new Map(all.filter(row => !isApplicationDocument(row)).map(row => [canonical(store.key(entity, row)), row]));
    const expected = new Map(snapshot.tables[entity].rows.map(row => [canonical(store.key(entity, row)), row]));
    const expectedGuards = new Set<string>();
    const report: Difference = { entity, sourceRows: expected.size, cloudRows: existing.size, identical: 0, missing: 0, different: 0, extra: 0, unversioned: 0, missingGuards: 0, conflictingGuards: 0, extraGuards: 0 };
    for (const [key, row] of expected) {
      const current = existing.get(key);
      if (!current) report.missing++;
      else if (checksum(applicationData(current)) !== checksum(row)) report.different++;
      else {
        report.identical++;
        if (!Number.isSafeInteger(current._version) || current._version < 1) report.unversioned++;
      }
      for (const guard of uniqueGuards(entity, row, store)) {
        const key = canonical(store.key(entity, guard));
        expectedGuards.add(key);
        const saved = guards.get(key);
        if (!saved) report.missingGuards++;
        else if (canonical(saved.owner) !== canonical(guard.owner)) report.conflictingGuards++;
      }
    }
    for (const key of existing.keys()) if (!expected.has(key)) report.extra++;
    for (const key of guards.keys()) if (!expectedGuards.has(key)) report.extraGuards++;
    tables.push(report);
  }
  const compatible = tables.every(table => !table.different && !table.extra && !table.unversioned && !table.conflictingGuards && !table.extraGuards);
  return { snapshotSha256: snapshot.sha256, at: new Date().toISOString(), tables, compatible,
    complete: compatible && tables.every(table => !table.missing && !table.missingGuards) };
}

/** Add missing records only. Never replaces/deletes a source record or unrelated cloud record.
 * Requires a complete preflight and read-only maintenance window; a retry after partial execution
 * compares checksums and resumes safely. Every row and its unique claims commit atomically.
 */
export async function importSnapshot(snapshot: MigrationSnapshot, store: DynamoStore): Promise<MigrationAudit> {
  const preflight = await auditSnapshot(snapshot, store);
  if (!preflight.compatible) throw new Error('Cloud data conflicts with the source snapshot. No import was started; review the audit report.');
  for (const entity of entityNames()) {
    for (const row of snapshot.tables[entity].rows) {
      const key = store.key(entity, row);
      const current = await store.get(entity, key);
      if (current && checksum(applicationData(current)) !== checksum(row)) throw new Error(`Cloud record changed after preflight: ${entity}. Import stopped without overwriting it.`);
      const operations: ReturnType<DynamoStore['createItem']>[] = [];
      if (!current) operations.push(store.createItem(entity, { ...row, _migration: snapshot.sha256 }));
      else if (!Number.isSafeInteger(current._version) || current._version < 1) throw new Error(`Existing unversioned cloud record requires manual reconciliation: ${entity}.`);
      for (const guard of uniqueGuards(entity, row, store)) {
        const saved = await store.get(entity, store.key(entity, guard));
        if (!saved) operations.push(store.createItem(entity, guard));
        else if (canonical(saved.owner) !== canonical(guard.owner)) throw new Error(`Unique constraint changed after preflight: ${entity}.`);
      }
      // Existing rows are version checked even when only their missing claim is being repaired.
      if (current && operations.length) operations.push({ ConditionCheck: { TableName: store.tableName(entity), Key: key,
        ConditionExpression: '#version = :version', ExpressionAttributeNames: { '#version': '_version' }, ExpressionAttributeValues: { ':version': current._version } } });
      await store.transact(operations);
    }
  }
  const final = await auditSnapshot(snapshot, store);
  if (!final.complete) throw new Error('Post-import verification is incomplete. Keep local data and inspect the audit before cutover.');
  return final;
}
