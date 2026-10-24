import 'dotenv/config';
import mysql from 'mysql2/promise';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DynamoStore, type Document } from '../../src/storage/dynamodb';
import { entityNames, makeSnapshot } from '../../src/storage/migration';
import type { EntityName } from '../../src/storage/table-definitions';

/** Offline source export only. No DynamoDB credentials or cloud calls are required. */
async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must identify the local source database.');
  const source = new URL(process.env.DATABASE_URL);
  if (source.protocol !== 'mysql:' || !['localhost', '127.0.0.1', '[::1]'].includes(source.hostname)) throw new Error('This exporter only accepts a local MySQL source.');
  const schema = decodeURIComponent(source.pathname.slice(1));
  const output = path.resolve(values.out || path.join(__dirname, '../../backups', `aws-migration-${new Date().toISOString().replace(/[:.]/g, '-')}`, 'snapshot.json'));
  const allowedRoot = path.resolve(__dirname, '../../backups') + path.sep;
  if (!output.startsWith(allowedRoot)) throw new Error('Snapshots contain private records and must be saved inside the ignored backend/backups directory.');
  const connection = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: '+05:30', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true });
  try {
    await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const [tables] = await connection.query<any[]>('SHOW FULL TABLES');
    const names = tables.filter(row => Object.values(row)[1] === 'BASE TABLE').map(row => String(Object.values(row)[0])).sort();
    const optionalEmptyEntities = ['hr_assistant_collections', 'hr_assistant_collection_rows', 'employee_information_employment_type_transitions'];
    const absent = entityNames().filter(entity => !names.includes(entity));
    if (names.some(entity => !entityNames().includes(entity as EntityName)) || absent.some(entity => !optionalEmptyEntities.includes(entity))) throw new Error('Local source tables differ from the reviewed application manifest.');
    const [columns] = await connection.query<any[]>('SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=?', [schema]);
    const rows = {} as Record<EntityName, Document[]>;
    const keyStore = new DynamoStore({ send: async () => { throw new Error('Source export must never contact DynamoDB.'); } } as any, 'migration-offline');
    for (const entity of entityNames()) {
      // These extension tables were lazily created by the original application only on first use.
      if (absent.includes(entity)) { rows[entity] = []; continue; }
      const [data] = await connection.query<any[]>('SELECT * FROM ??', [entity]);
      rows[entity] = data.map(row => {
        const normalized: Document = { ...row };
        for (const column of columns.filter(column => column.TABLE_NAME === entity)) {
          const value = normalized[column.COLUMN_NAME];
          if (value === null) continue;
          if (['tinyint', 'smallint', 'mediumint', 'int'].includes(column.DATA_TYPE)) {
            const numeric = Number(value);
            if (!Number.isSafeInteger(numeric)) throw new Error(`Unsafe integer source value: ${entity}.${column.COLUMN_NAME}`);
            normalized[column.COLUMN_NAME] = numeric;
          }
          // Decimal source strings are retained exactly, avoiding financial precision loss.
        }
        keyStore.key(entity, normalized);
        return normalized;
      });
    }
    const [foreignKeys] = await connection.query<any[]>('SELECT TABLE_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND REFERENCED_TABLE_NAME IS NOT NULL', [schema]);
    for (const foreignKey of foreignKeys) {
      const [counts] = await connection.query<any[]>('SELECT COUNT(*) AS missing FROM ?? child LEFT JOIN ?? parent ON child.??=parent.?? WHERE child.?? IS NOT NULL AND parent.?? IS NULL', [foreignKey.TABLE_NAME, foreignKey.REFERENCED_TABLE_NAME, foreignKey.COLUMN_NAME, foreignKey.REFERENCED_COLUMN_NAME, foreignKey.COLUMN_NAME, foreignKey.REFERENCED_COLUMN_NAME]);
      if (Number(counts[0].missing)) throw new Error(`Source orphan records exist: ${foreignKey.TABLE_NAME}.${foreignKey.COLUMN_NAME}. Repair the local source before export.`);
    }
    const snapshot = makeSnapshot(schema, rows, keyStore);
    await connection.commit();
    await mkdir(path.dirname(output), { recursive: true });
    const file = await open(output, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(snapshot)); } finally { await file.close(); }
    console.log(JSON.stringify({ output, tables: entityNames().length, rows: Object.values(rows).reduce((total, table) => total + table.length, 0), sha256: snapshot.sha256, readOnlySource: true }));
  } catch (error) { await connection.rollback(); throw error; }
  finally { await connection.end(); }
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Source export failed.'); process.exitCode = 1; });
