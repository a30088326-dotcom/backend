# Local HR verification — 24 October 2026

Project: `D:\projects\peoples-management-main`
App: http://localhost:5174/onboarding
Database: local MySQL, `hr_onboarding`.

## Verified behavior

- Browser-created company, location, department and designation records saved, linked correctly in MySQL, survived editing/reloading and appeared as selectable Employee Information options. Hierarchy edits retained the company/location links and effective date.
- A browser-created benefit retained its selected salary grade and a zero amount after editing and a full reload. All five browser-created test records and their links were removed after verifying that no real employee used them.
- Existing company and employee Save controls succeeded. Personal, contact, emergency, bank, employment and uploaded document views were checked.
- Automated tests exercise create/edit/reload/delete for all 32 EIM data types, plus employee mapping persistence in MySQL. The suite passed **588/588 checks**.
- Frontend tests passed **9/9 test files**, including **64 EIM create/edit save bindings**, reference dropdowns, inactive records, failed-save recovery, private documents, route restrictions, half-day leave and report export/filtering.
- Employee clock-in/break/out, leave request/manager approval/history/cancellation and balance restoration were tested through the UI using isolated test accounts. The real employee's credentials were preserved.
- Original leave-rule tests, attendance calculation tests, performance workflow tests and HR Assistant tests were also run. Both application type checks and the frontend build passed.
- Local MySQL integrity checks found no missing or duplicated employee mappings, orphaned foreign keys, invalid leave/approver mappings or duplicated attendance days. The two real employee profiles and 20 uploads remain.

## Fixes

EIM reference dropdown response handling; department edit save dispatch; hierarchy edits losing hidden company/location links; benefit edits writing to a nonexistent column; transactional benefit-to-salary-grade links; geography name/code fields; salary-grade inputs; inactive and zero values; actionable save errors; working attendance reports and CSV filtering; current-year available leave balances; approval failure/retry handling; authenticated document viewing; invalid invitation handling; shift-aware attendance calculations; and the onboarding records/progress page.

## Current operational status

- The existing database has no holiday calendar groups/day types. The calendar now states this explicitly and prevents an empty or unloaded calendar from being saved. Public holidays and company calendar policies were not invented.
- The 20 actual employee documents are pending HR review and no actual contract has been issued. Tests did not approve real documents or sign real agreements.
- The actual employee account retains its existing mandatory password-change requirement. Employee workflows were validated with isolated test accounts rather than replacing that password.
- The build succeeds with a JavaScript bundle-size advisory. This is a loading-performance concern, not a failed build.

## Start and recheck

Double-click **Start Local HR.bat** to start the app. It builds changed frontend sources before serving the local app. After backend code/configuration edits, restart the local API so the saved changes take effect.

Double-click **Check Local HR.bat** to run the type checks, frontend tests, whole-system tests, attendance calculations, leave rules, performance and HR Assistant tests. This checker does not send test emails. Results are saved in `backend/repair-audit/local-verification.json`.

Passing tests validate the covered behavior; they do not guarantee that every future code, schema, policy or configuration change is error-free.

## Backup and evidence

Final database/upload backup: `backend/backups/system-repair-2026-10-23T18-33-11-399Z` — 117 tables, 515 rows and 20 uploaded files, with checksums in its manifest.

Detailed reports are in `backend/repair-audit/`: `system-integration.json`, `system-integrity.json`, `browser-workflows.json`, `eim-ui-mapping.json` and `eim-benefit-ui.json`. No AWS deployment was performed.
