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
- [ ] Phase 3: link the same project ID across checkout paths and verify that project-scoped history follows it.
