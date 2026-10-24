import 'dotenv/config';
import { auditSnapshot } from '../../src/storage/migration';
import { cloudTarget } from './cloud-target';

async function main() {
  const { snapshot, store, target, saveReport } = await cloudTarget();
  const report = await auditSnapshot(snapshot, store);
  const output = await saveReport('audit', report);
  console.log(JSON.stringify({ target, output, compatible: report.compatible, complete: report.complete, tables: report.tables.length, readOnly: true }));
  if (!report.compatible) process.exitCode = 2;
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Cloud audit failed.'); process.exitCode = 1; });
