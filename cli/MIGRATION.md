# Phase 1 migration baseline

The current SAgent server uses PGlite at `~/.sagent/auth/data` for Better Auth
(`user`, `session`, `account`, `verification`). It also opens
`~/.sagent/projects/<sanitized-local-path>/data`, but its Prisma schema has no
conversation, task, or agent-state models. The CLI has `login`, `logout`, and
`whoami`; device login is unfinished because the server has no device approval
endpoint. Existing auth rows are not imported into local SQLite. Phase 2 will
authenticate against the hosted account service.

Phase 1 creates `~/.sagent/global.sqlite` and
`~/.sagent/projects/<stable-project-id>/state.sqlite`. A project ID is a UUID
stored in the global database, keyed locally by its canonical Git root (or
directory path when there is no Git repository).
The Git remote is recorded as a hint but is never used as an identity key: it
can be absent or can change. Phase 2 sync must associate the same ID with a
remote account and link a new checkout explicitly.
Moving a checkout also requires relinking its new local path to its existing ID.

The old PGlite directories are left untouched. Before a future importer changes
data, it must back up both directories while the server is stopped, read the
backup, compare row counts and representative IDs, and retain the backup for
rollback. The included fixture records the existing layout and eligible data.
There are currently no SAgent chat/task rows to import. Do not copy Better Auth
sessions or OAuth accounts into local SQLite.

Run `sagent backup-legacy` with the development server stopped before any later
PGlite import. It copies the old directories to `~/.sagent/backups/`, verifies
file lists and SHA-256 checksums, and never removes the originals. The import
step is unnecessary for the current schema because it has no workspace records.
A future schema with workspace records requires an importer and row-level
verification before the format changes.

Reusable TAgent examples live in `TAgent-master/server/src/lib/workflow`,
`context`, and `sandbox`; the recovery, context, and Docker sandbox tests there
are design references. The Google ADK runtime and its storage are not imported.
