# Local desktop helpers

These files belong beside the separate `frontend` and `backend` checkouts. They
are versioned here because the shared parent folder is not a Git repository.

For a fresh checkout, place both repositories in one folder using those names,
install their dependencies, configure the backend's ignored `.env`, and copy
the helper files from this directory to the shared parent folder. Keep this
README in `backend/local-tools`.

`Start Local HR.bat` starts http://localhost:5174. `Check Local HR.bat` runs the
local verification suite against temporary test databases. Database backups,
employee uploads and passwords are kept outside Git.

The launchers use Node.js from PATH, with the existing local Windows installation
as a fallback. A different computer needs its own installed Node.js and MySQL.
