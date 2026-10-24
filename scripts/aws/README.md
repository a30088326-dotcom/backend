# MySQL to separate DynamoDB tables

These commands cover all 120 reviewed application tables and primary key shapes.
The 117 original source tables are preserved; two Assistant extension tables and
the employment transition history table complete the feature manifest. These three
tables may be absent only when their features have not created local data yet.
Run from `backend` with `tsx` and the authenticated AWS operator's normal credential
chain. Never paste AWS secrets in a command or commit a snapshot. Exports contain
private employee records and password hashes and are restricted to ignored `backups/`.

1. Stop application writes and take the existing full SQL + uploads backup.
2. `tsx scripts/aws/export-mysql.ts` makes a read-only, consistent local source snapshot.
   It verifies all application tables, source columns, primary/unique keys and foreign keys.
3. Review the generated snapshot path and checksum. Copy uploaded files separately
   into the configured private cloud file store; this utility migrates database rows.
4. Set the authenticated AWS profile/role, then run a read-only comparison:

   ```text
   tsx scripts/aws/audit-tables.ts --snapshot backups/EXPORT/snapshot.json --region ap-southeast-2 --account 375461735016 --prefix peoples-management
   ```

5. `import-snapshot.ts` accepts the same options and defaults to a dry run. Existing
   different, extra, unversioned or conflicting cloud records block the import. It
   never replaces cloud rows, deletes tables or changes another application's data.
   Reconcile differences manually and review a new audit before proceeding.
6. To add only missing data during a verified maintenance window, additionally pass
   `--apply --maintenance-window --confirm-target 375461735016:ap-southeast-2:peoples-management
   --confirm-sha256 THE_EXACT_SNAPSHOT_CHECKSUM`. Target ARN, ACTIVE status and key
   schema are checked for every table before writes. Every source row and its unique
   constraint claims are one atomic transaction. An interrupted import can resume
   without overwriting successful records.
7. Require final full-table `complete: true`, file checksums, native API smoke tests,
   employee/admin authorization and actual hosted browser workflows before switching
   traffic or removing old hosting. Keep the recoverable SQL + uploads backup.

Local MySQL removal is intentionally absent: it is a separate final cutover action
after the live system and all data have been verified, as requested by the user.
Do not drop system databases or unrelated application databases.

## Native repository contract

`repository()` exposes `get`, paginated `list`, explicitly bounded `find`, `create`,
`replace`, `remove` and `transaction(async tx => ...)`. Documents carry `_version`.
All writes use native DynamoDB commands and optimistic concurrency conditions.
Unique-key claims are reserved metadata items in the same entity table; enumeration
never returns those items. Business transactions larger than 100 operations fail
atomically rather than being split into partial commits.

Scans are not relational predicate locks. Declare any new unique business key in
the reviewed schema and migrate its claims, or condition-check a shared aggregate
record in the same transaction. `find` stops with an explicit error after 10,000
scanned records; a scalable indexed access pattern is required before that scale.
