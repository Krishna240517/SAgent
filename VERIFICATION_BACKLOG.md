# Verification backlog

These checks need external services, credentials, or a second machine. Complete
them after all seven phases; keep local automated checks in each phase.

Current verification focuses on Windows with Docker Desktop running Linux containers.
The cross-platform results below are historical.

- [x] Phase 1: packed CLI gate passed on Windows, macOS, and Linux from a clean checkout ([CI run, attempt 2](https://github.com/Krishna240517/SAgent/actions/runs/44133862883)). The first macOS attempt was cancelled before a runner started.
- [x] Phase 2: both Prisma migrations applied to hosted Neon PostgreSQL, and `prisma migrate status` reported the schema up to date. Using a temporary test identity and browser session, the SAgent auth handler issued a device code, approved it, exchanged it for a bearer token, resolved the expected user, and rejected the token after sign-out. The test records were cleaned up.
- [x] Phase 2: completed GitHub browser sign-in and device approval against the local API backed by hosted PostgreSQL. In an isolated CLI profile, `sagent whoami` matched the authenticated user. After `sagent logout`, the token file was gone and the API returned no session for the former bearer token.
- [x] Phase 2: a live OpenRouter key streamed `READY` through SAgent's authenticated chat endpoint and CLI stream reader with both `openrouter/free` and `openai/gpt-4o-mini` in separate tests. The earlier `openai/gpt-4.1-mini` request returned HTTP 402 with no available credit balance.
  A simulated primary rate limit also triggered one live `openai/gpt-4.1-nano` fallback request, and the CLI received the complete `READY` reply.
- [ ] Phase 2: resume a conversation from two separate machines and test offline reconnection. Deferred until a second machine is available. Automated sync and offline reconnection tests passed locally.
- [ ] Phase 2: validate the full interactive terminal chat through a real browser-approved login and hosted API.
- [x] Phase 3: local tests link the same project ID across separate checkout paths and sync project-scoped history between isolated SQLite stores.
- [ ] Phase 3: verify project-scoped history and Git revision checks on two physical machines. Deferred until a second machine is available.
- [x] Phase 3: reviewed live `sagent code ask` citations for definitions and callers in Commander.js (`camelcase`, a5a7dc0), SAgent TypeScript (`collectEvidence`), Flask (`get_root_path`, 49943b5), and Gson (`checkValidFloatingPoint`, f951302). After fixing search ranking, the JavaScript answer cited the correct implementation and caller. Its wording about lowercase input was imprecise: the implementation preserves the first segment. Each read-only run preserved the checkout's Git status.
- [x] Phase 3: packed Tree-sitter and Ripgrep CLI passed on Windows, macOS, and Linux ([CI run](https://github.com/Krishna240517/SAgent/actions/runs/44318042005)).
- [x] Phase 4: local Docker fixtures verify one approved edit each in JavaScript, TypeScript, Python, and Java; rejected edits, failed checks, and timeout isolation have local tests.
- [x] Phase 4: CLI typecheck, test, packed install, and smoke checks passed on Windows, macOS, and Linux ([CI run](https://github.com/Krishna240517/SAgent/actions/runs/44327899317)). Docker fixture tests skip when Docker or images are unavailable.
- [x] Phase 4: verified live `sagent code fix` on a disposable checkout of `mewwts/addict` at `75284f9`. A seeded shallow-copy regression failed two upstream tests. The model proposed restoring `Dict.deepcopy`, the interactive prompt accepted approval, and both focused and discovery runs passed all 128 tests in Docker. Comparison with upstream found one removed blank line, which led to a regression test for trailing newlines in the approval preview.
- [x] Phase 4: run Docker sandbox checks on Windows, macOS, and Linux hosts with their required images installed. Native Ubuntu and Intel macOS passed the required Docker job on [run 44397940735](https://github.com/Krishna240517/SAgent/actions/runs/44397940735).
  Windows with Docker Desktop and Ubuntu under WSL2 each passed all seven sandbox and edit-workflow tests with zero skips. Both runs used local Node, Python, and Java sandbox images.
- [ ] Phase 4: verify real npm, Python dependency, Maven, and Gradle projects with offline dependencies available in the sandbox.
  On Windows, the prepared SAgent npm image imported TypeScript offline. Python (six) and Maven (JUnit) dependency fixtures also passed offline. SAgent's full sandbox typecheck reaches the compiler but cannot resolve `src/commands/auth/token.ts`, which the credential filename filter excludes. Full upstream project builds remain open.

- [ ] Phase 5: repeat the approved-plan handoff on two physical machines through the hosted API. Deferred until a second machine is available.
- [ ] Phase 5: exercise companion and coding roles against the configured model and review their decisions on a real task.
- [x] Phase 5: packed CLI installation and smoke checks passed on Windows, macOS, and Linux ([CI run](https://github.com/Krishna240517/SAgent/actions/runs/44332348478)).

- [x] Phase 6: local Docker MCP handshake, image inspection, and build/run/remove on a disposable fixture. A coding question received the inspection result with its action ID using a fixture model.
- [ ] Phase 6: exercise the issue-to-PR workflow with a scoped GitHub token on a disposable repository.
- [ ] Phase 6: verify an authenticated image push and Docker Hub repository create/update with a scoped test account.
- [ ] Phase 6: verify scoped reads, approved writes, RBAC/IAM denials, and expired credentials on a disposable local Kubernetes namespace and an EKS cluster.
- [ ] Phase 6: run the packed CLI and pinned connector binaries on Windows, macOS, and Linux.

- [ ] Phase 7: install the standalone GitHub Release via WinGet on Windows and the versioned shell installer on macOS and Linux. On clean hosts without Node.js or npm, verify `sagent doctor`, a repository search, and a Tree-sitter repo map.
