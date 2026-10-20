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

To refresh the schema export, run the read-only exporter from `backend/`:

```powershell
node scripts/export-schema.cjs
```

The exporter prints a JSON object containing the SQL and manifest; it does not
change the database or overwrite files. Save a reviewed export as `schema.sql`
and `schema-manifest.json` when the schema changes.
