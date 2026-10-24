Uploaded files are private. Clients fetch `/api/files/:filename` using the existing
Authorization bearer header, then preview the returned blob. Legacy `/uploads/`
paths use the same authentication and ownership/module-scope checks. Tokens must
never be placed in file URLs.

New document URLs are API-relative and do not contain a localhost hostname.
Existing local URLs can be converted with:

`npx tsx scripts/repair-local-files-attendance.ts`

This is a dry run; add `--apply` after taking a full database backup. It also
recalculates completed attendance using the assigned shift and original punch
logs. It preserves approved corrections, document statuses and original logs.
A before-image is saved under the ignored `backups/` folder.

For deployment, transfer the `uploads/` directory **alongside** the SQL backup to
persistent backend storage (or implement equivalent private object storage).
Copying the database alone does not copy file bytes. Keep these files and database
backups private. Restoring the database requires restoring its matching uploads.

Attendance uses Asia/Colombo time independently of the server timezone. Unpaid
punch breaks are excluded; paid breaks count. Manual/approved time intervals use
the configured unpaid break duration once. Regular hours use the configured
full-day hours (or scheduled hours minus unpaid break when unset). Overtime is
awarded only for an eligible shift after its overtime grace threshold; once that
threshold is reached, the time beyond regular hours is overtime. Unassigned days
do not acquire an invented overtime policy. Night sessions belong to the date of
their opening In punch. Original punch logs remain audit evidence.
