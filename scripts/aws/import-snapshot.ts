import 'dotenv/config';
import { auditSnapshot, importSnapshot } from '../../src/storage/migration';
import { cloudTarget } from './cloud-target';

async function main() {
  const { snapshot, store, target, apply, saveReport } = await cloudTarget(true);
  const preflight = await auditSnapshot(snapshot, store);
  const preflightOutput = await saveReport('preflight', preflight);
  console.log(JSON.stringify({ target, output: preflightOutput, compatible: preflight.compatible, complete: preflight.complete, mode: apply ? 'apply' : 'dry-run' }));
  if (!preflight.compatible) throw new Error('Preflight found cloud/source conflicts; no writes were performed.');
  if (!apply) return;
  const report = await importSnapshot(snapshot, store);
  const output = await saveReport('verified-import', report);
  console.log(JSON.stringify({ target, output, complete: report.complete, tables: report.tables.length }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Cloud import failed.'); process.exitCode = 1; });
