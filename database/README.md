# MySQL database

`schema.sql` contains the current database structure, including tables, indexes,
foreign keys, and any views, triggers, routines, or events present during export.
`schema-manifest.json` records the exported structures and foreign key mappings.
Employee records, passwords, uploaded documents, and other live data are not included.

Create an empty database, for example `hr_onboarding`, in MySQL Workbench or
phpMyAdmin, select it, and run/import `schema.sql`. The script contains no database
deletion commands and must be imported into an empty database.

Configure the backend repository's `.env` with a `DATABASE_URL` pointing to that database.
Demo data can be added deliberately using the backend seed scripts.

For a new local installation, run `npm run db:seed-lookups` from `backend/` to
populate the onboarding gender, common nationality, currency, and relationship choices.
This adds missing reference values only, preserves existing settings, and creates
no employees. More nationality options can be managed through EIM Admin.

Run `npm run db:seed-leave` to add the original Annual, Casual, and Medical
leave definitions from `src/seed.ts` and the current leave year. This local-only
setup preserves existing definitions, including inactive records, and adds no
employees or balances. Employee allocations still use the existing leave rule
evaluator; the type's default amount is not a promise of an employee's balance.
Neither setup command restores deleted historical data. That requires a backup
containing the original records, rather than this structure-only schema.

To recover configuration from a reviewed system backup without restoring former
employees, run `node scripts/restore-module-settings.cjs "BACKUP_DIRECTORY"`.
The first run validates the checksum and trials the merge, then rolls it back.
After reviewing `repair-audit/module-settings-restore-preview.json`, add `--apply`.
Save a current backup first with `node scripts/backup-system.cjs`.
Only the explicit configuration-table allowlist is imported. Employee accounts,
permissions, documents, assigned goals/reviews and transactions are excluded;
old person attribution is cleared. Existing lookup IDs are mapped so current
onboarding data stays valid. Original leave definitions replace fresh defaults;
other existing configuration is preserved. This operation is local MySQL only.

To refresh the schema export, run the read-only exporter from `backend/`:

```powershell
node scripts/export-schema.cjs
```

The exporter prints a JSON object containing the SQL and manifest; it does not
change the database or overwrite files. Save a reviewed export as `schema.sql`
and `schema-manifest.json` when the schema changes.
