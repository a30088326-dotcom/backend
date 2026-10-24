import { DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { parseArgs } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DynamoStore } from '../../src/storage/dynamodb';
import { entityNames, validateSnapshot, type MigrationSnapshot } from '../../src/storage/migration';
import { tableDefinitions } from '../../src/storage/table-definitions';

export async function cloudTarget(allowApply = false) {
  const { values } = parseArgs({ options: {
    snapshot: { type: 'string' }, region: { type: 'string' }, account: { type: 'string' }, prefix: { type: 'string' },
    apply: { type: 'boolean', default: false }, 'confirm-target': { type: 'string' }, 'confirm-sha256': { type: 'string' },
    'maintenance-window': { type: 'boolean', default: false },
  } });
  if (!values.snapshot || !values.region || !values.account || !values.prefix) throw new Error('--snapshot, --region, --account and --prefix are required.');
  if (!/^\d{12}$/.test(values.account) || !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(values.region)) throw new Error('Invalid account or AWS region.');
  const snapshot = JSON.parse(await readFile(path.resolve(values.snapshot), 'utf8')) as MigrationSnapshot;
  const client = new DynamoDBClient({ region: values.region, maxAttempts: 6 });
  const store = new DynamoStore(DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } }), values.prefix);
  validateSnapshot(snapshot, store);
  const target = `${values.account}:${values.region}:${values.prefix}`;
  if (values.apply && (!allowApply || values['confirm-target'] !== target || values['confirm-sha256'] !== snapshot.sha256 || !values['maintenance-window'])) {
    throw new Error('Import requires --apply, --maintenance-window, --confirm-target account:region:prefix and --confirm-sha256 matching this snapshot.');
  }
  // Account, region, every physical key schema and readiness are verified before any writes.
  for (const entity of entityNames()) {
    const response = await client.send(new DescribeTableCommand({ TableName: store.tableName(entity) }));
    const table = response.Table;
    if (!table || table.TableStatus !== 'ACTIVE' || table.TableArn !== `arn:aws:dynamodb:${values.region}:${values.account}:table/${store.tableName(entity)}`) throw new Error(`Target identity/readiness mismatch: ${entity}`);
    const definition = tableDefinitions[entity];
    const keys = [definition.partitionKey, ...('sortKey' in definition ? [definition.sortKey] : [])];
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      const actual = table.KeySchema?.find(entry => entry.KeyType === (index === 0 ? 'HASH' : 'RANGE'));
      const type = table.AttributeDefinitions?.find(attribute => attribute.AttributeName === key.name)?.AttributeType;
      if (actual?.AttributeName !== key.name || type !== key.type) throw new Error(`Target key schema mismatch: ${entity}`);
    }
    if (table.KeySchema?.length !== keys.length) throw new Error(`Unexpected target key count: ${entity}`);
  }
  return { snapshot, store, target, apply: values.apply, async saveReport(label: string, report: unknown) {
    const directory = path.resolve(__dirname, '../../repair-audit/aws-migration');
    await mkdir(directory, { recursive: true });
    const filename = path.join(directory, `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await writeFile(filename, JSON.stringify({ target, ...report as object }, null, 2), { flag: 'wx', mode: 0o600 });
    return filename;
  } };
}
