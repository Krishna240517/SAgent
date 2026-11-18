# Verification backlog

These checks need external services, credentials, or a second machine. Complete
them after all seven phases; keep local automated checks in each phase.

- [x] Phase 1: packed CLI gate passed on Windows, macOS, and Linux from a clean checkout ([CI run, attempt 2](https://github.com/Krishna240517/SAgent/actions/runs/44133862883)). The first macOS attempt was cancelled before a runner started.
- [ ] Phase 1: claim the `@sagent/cli` npm scope/name before publication.
- [ ] Phase 2: apply Prisma migrations to a hosted PostgreSQL database and run the auth flow there.
- [ ] Phase 2: complete a real GitHub browser sign in, device approval, and CLI logout.
- [ ] Phase 2: make a live model request with a production API key.
- [ ] Phase 2: resume a conversation from two separate machines and test offline reconnection.
- [ ] Phase 2: validate the full interactive terminal chat through a real browser-approved login and hosted API.
- [x] Phase 3: local tests link the same project ID across separate checkout paths and sync project-scoped history between isolated SQLite stores.
- [ ] Phase 3: verify project-scoped history and Git revision checks on two physical machines.
- [ ] Phase 3: run read-only coding questions on real JS, TS, Python, and Java repositories with a live model and review its file citations.
- [x] Phase 3: packed Tree-sitter and Ripgrep CLI passed on Windows, macOS, and Linux ([CI run](https://github.com/Krishna240517/SAgent/actions/runs/44318042005)).
- [x] Phase 4: local Docker fixtures verify one approved edit each in JavaScript, TypeScript, Python, and Java; rejected edits, failed checks, and timeout isolation have local tests.
- [x] Phase 4: CLI typecheck, test, packed install, and smoke checks passed on Windows, macOS, and Linux ([CI run](https://github.com/Krishna240517/SAgent/actions/runs/44327899317)). Docker fixture tests skip when Docker or images are unavailable.
- [ ] Phase 4: test `sagent code fix` with a live model and interactive approval on a real repository.
- [ ] Phase 4: run Docker sandbox checks on Windows, macOS, and Linux hosts with their required images installed.
- [ ] Phase 4: verify real npm, Python dependency, Maven, and Gradle projects with offline dependencies available in the sandbox.

- [ ] Phase 5: repeat the approved-plan handoff on two physical machines through the hosted API.
- [ ] Phase 5: exercise companion and coding roles against the configured model and review their decisions on a real task.
- [x] Phase 5: packed CLI installation and smoke checks passed on Windows, macOS, and Linux ([CI run](https://github.com/Krishna240517/SAgent/actions/runs/44332348478)).
