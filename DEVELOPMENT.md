# Development branch

Use `dev` for backend edits and the frontend repository's `dev` branch for UI
edits. Both repositories remain separate.

```powershell
git switch dev
git pull --ff-only
```

After editing:

```powershell
npm run typecheck
npm run test:system
npm run test:leave
npm run test:attendance-calculation
npm run test:performance
npm run test:assistant
git status
git add .
git diff --cached --stat
git commit -m "Describe the backend change"
git push
```

The integration tests use temporary databases. The complete desktop checker is
packaged in `local-tools/`. Configure local MySQL before running these tests.

Review staged files before committing. `.env`, employee documents, live SQL
backups and test reports are ignored. Editing a record through the HR app saves
data in MySQL; Git uploads code and reviewed schema changes, not live records.

For release, review a pull request from `dev` into `main`. This branch setup does
not change AWS configuration or deploy an application.
