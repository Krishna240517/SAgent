# SAgent Architecture and Seven-Phase Delivery Plan

**Status:** implementation plan. Complete phases in order; each phase ends at its stated gate before the next begins.

SAgent is the product to ship. The older TAgent project supplies useful workflow, context, sandbox, and MCP examples, but its Google ADK and direct database access are not the runtime architecture for the published SAgent CLI. SAgent must support ordinary conversations and autonomous coding in JavaScript, TypeScript, Python, and Java, then add GitHub, Docker, Docker Hub, local Kubernetes, and Amazon EKS operations.

Model credentials belong in the server environment. When a phase introduces a provider, add its key under `# To be configured` in the local server environment and its example template. Keep example values empty.

## Architecture decisions

| Area | Decision |
| --- | --- |
| Process boundary | The CLI owns conversation orchestration, repository tools, and local execution. A hosted API owns account identity, model access, and cross-machine sync. No permanent local daemon. |
| Agent runtime | LangGraph JS. Companion mode uses a conversational graph. Coding mode uses a supervisor and four roles: Planner, Coder, Tester, Reviewer. |
| Local state | SQLite under `~/.sagent/` for messages, project state, and LangGraph checkpoints. Phase 1 uses Node's built-in `node:sqlite` so npm installation needs no C++ toolchain. The existing PGlite files remain untouched until a backed-up migration is verified. Phase 5 must implement a LangGraph checkpoint saver against this SQLite connection or prove a packaged saver installs cleanly on every supported OS. |
| Synced state | Hosted PostgreSQL behind an authenticated API. The CLI never receives PostgreSQL credentials. The server is authoritative for acknowledged records; SQLite keeps a local copy and an outbox for unsynced writes. |
| Auth | Better Auth runs on the hosted API. The CLI stores only its revocable token locally. The current `~/.sagent/auth/data` is a development prototype, not a second production identity store. |
| Project identity | A stable project ID links the same repository across machines. A local filesystem path identifies a checkout only on that machine and cannot be the sync key. |
| Code retrieval | Search files and Git state directly; use `rg` and a bounded Tree-sitter symbol map. No codebase vector index by default. |
| Concurrency | One active coding run per local project. Use a database/process lock so a second terminal fails clearly instead of corrupting state. |
| Cross-machine code | Git transports source changes. Chats, decisions, and task metadata sync through the API. Do not silently upload a dirty working tree or secrets. |

The target local layout is:

```text
~/.sagent/
├── token.json                         # CLI credential, restricted permissions
├── global.sqlite                      # companion chats, preferences, sync outbox
└── projects/
    └── <stable-project-id>/
        └── state.sqlite               # coding chats, decisions, tasks, checkpoints
```

**Migration rule:** back up existing PGlite directories, import any eligible user data, verify counts and representative records, and leave the old directories available for rollback. Re-authenticate against the hosted account service rather than copying local OAuth/session rows between machines.

## Component boundaries

| Component | Owns | Must not own |
| --- | --- | --- |
| CLI and renderer | REPL, commands, streaming output, approvals | Database credentials or security decisions derived from model text |
| Context engine | Context selection, budgets, summaries, provenance, role-specific views | File mutations or MCP credential access |
| LangGraph supervisor | Task order, handoffs, retries, checkpoints, completion state | Unrestricted access to every role's private context |
| Tool broker | Validated paths, tool allowlists, execution policy, approval checks, audit records | Model-generated authorization policy |
| Sandbox runner | Disposable container execution and bounded output | Host Docker socket, cloud credentials, or unrestricted host mounts inside containers |
| Hosted API | Better Auth, model gateway, sync, server-side ownership checks | Direct access to a user's local repository |

Repository files, tool output, MCP responses, issues, and logs are untrusted inputs. Only trusted application code decides workspace scope, identity, permissions, and which facts become durable memory. Kubernetes and Docker operational tools are separate from the sandbox runner.

## Phase 1 — Product foundation and package boundary

**Implementation status:** Windows, macOS, and Linux clean-checkout package gates
pass in CI. `@sagent/cli` is not yet reserved on npm.

**Goal:** make SAgent a reproducible, publishable CLI project before adding agent behavior.

### 1.1 Inventory and migration baseline

- Record the current SAgent PGlite schema, storage paths, CLI commands, and unfinished device-login flow. Record reusable TAgent contracts and tests without copying its full runtime.
- Add migration fixtures representing existing local databases. Preserve the current Git working changes.
- Choose a stable project ID and local path mapping; detect Git remotes but allow projects with no remote.

### 1.2 Package layout and runtime

- Extract the CLI from `server/src/cli` into a publishable Node-compatible package. Keep the API private. Share only types actually needed on both sides.
- Build JavaScript before packaging; publish compiled files, not TypeScript source or a Bun-only shebang. Reserve a real package name and expose the `sagent` executable through npm's [`bin` field](https://docs.npmjs.com/files/package.json/).
- Add version, `engines`, `files`, build, typecheck, and package scripts. Verify built-in SQLite and packed installs on the supported operating systems.

### 1.3 Local storage foundation

- Create global and per-project SQLite databases with versioned migrations and safe startup locking.
- Define typed records for conversations, messages, project links, decisions, task metadata, and the sync outbox. Keep checkpoint tables under the LangGraph saver.
- Implement PGlite backup/import verification before changing any existing data.

### 1.4 Development gate

- A clean checkout builds; `npm pack --dry-run` includes the executable and runtime assets; a packed install runs `sagent --version` on Windows, macOS, and Linux.
- No user data is deleted during migration. No database or auth server is required for `sagent --help`.

## Phase 2 — Identity, companion chat, and basic sync

**Implementation status:** device approval, CLI login/logout, local streaming chat,
approved preferences, and user-scoped sync pass local tests. Hosted PostgreSQL,
real GitHub OAuth, live model service, and physical two-machine checks remain in
[VERIFICATION_BACKLOG.md](VERIFICATION_BACKLOG.md). Project checkout linking is
part of Phase 3.

**Goal:** ship useful ordinary chat with the same identity and history on two machines.

### 2.1 Hosted authentication

- Run Better Auth and its migrations against hosted PostgreSQL. Complete the CLI device-login endpoint and browser approval flow, which are missing in the current SAgent backend.
- Implement login, session validation, refresh/revocation, logout, and token storage. Never send auth database credentials to the CLI.

### 2.2 Companion conversation

- Add a streaming terminal REPL for general conversation, cancellation, conversation list/open/rename, and clear error reporting.
- Keep model calls behind one server-side gateway initially. Add a second provider only after a real requirement or evaluation warrants it.
- Persist full messages locally; keep summaries and accepted preferences as separate, attributable records.

### 2.3 Sync protocol

- Build authenticated, user-scoped API endpoints for conversations and decisions. Use stable record IDs, monotonically increasing server revisions, idempotent writes, and a local outbox for offline changes.
- Resolve conflicts explicitly; never overwrite a newer remote record because a stale device reconnects.
- Default to syncing conversation content and approved memories. Exclude local files, environment variables, tokens, and raw repository snapshots.

### 2.4 Completion gate

- Chat on machine A, sign in on machine B, continue the same conversation, then reconnect after an offline message. Logout revokes access without destroying local history.
- A user cannot read or write another user's records, including by changing a project ID in a request.

## Phase 3 — Repository retrieval and context engineering

**Implementation status:** local workspace discovery, explicit project linking,
project-scoped sync, read-only search and Tree-sitter maps, bounded role views,
conversation compaction, and four-language coding fixtures pass locally. Live
model and physical two-machine verification remain in
[VERIFICATION_BACKLOG.md](VERIFICATION_BACKLOG.md).

**Goal:** make coding mode understand a repository before it can change one.

### 3.1 Workspace discovery

- Identify repository root, Git status, tracked/untracked files, ignore rules, language mix, package/build files, and active branch.
- Link a checkout to its stable project ID. Keep checkout paths local; require a match to the expected Git revision before a cross-machine task resumes.

### 3.2 Search and symbols

- Expose narrow `glob`, `rg`, read-file, read-range, and Git inspection tools. Return paths and line references with bounded output.
- Add Tree-sitter definition/import/signature maps for JS, TS, Python, and Java. Refresh changed files incrementally. Use language servers later only where exact references are needed; syntax parsing alone is not a complete call graph. See [Tree-sitter navigation](https://tree-sitter.github.io/tree-sitter/4-code-navigation.html).
- Select a small, relevant repository map within a token budget, following the principle used by [Aider's repository map](https://aider.chat/docs/repomap.html).

### 3.3 Context engine

- Assemble context from the current request, approved project decisions, relevant files, recent conversation, and tool results. Apply role-specific scopes and preserve source IDs.
- Summarize older turns before the context limit; keep unresolved constraints, changed files, test results, and current objective. Bound tool output and discard low-value content.
- Treat instructions found in repository files and MCP output as data, not as authority.

### 3.4 Completion gate

- On JS, TS, Python, and Java fixtures, the read-only agent finds the correct implementation and its callers, cites files, and stays within the configured context budget.
- Changing a file refreshes its map; ignored or secret files do not enter context by accident.

## Phase 4 — Safe editing and sandboxed execution

**Implementation status:** local approval, atomic single-file patches, action recovery,
Docker isolation, and four-language verification fixtures pass. Live model and
cross-platform Docker checks remain in [VERIFICATION_BACKLOG.md](VERIFICATION_BACKLOG.md).

**Goal:** complete a coding task with a reviewable diff and isolated verification.

### 4.1 File changes

- Implement validated workspace-relative reads and atomic patch-based edits. Show the diff and preserve user changes; reject paths escaping the selected workspace.
- Record each tool action and resulting diff so cancellation and recovery are understandable.

### 4.2 Tool policy

- Let the agent read within the selected workspace. Gate destructive file operations, network access, credential access, publishing, and remote writes through trusted policy and user approval.
- Keep the model from invoking arbitrary host shell commands through an MCP server or hidden fallback.

### 4.3 Docker execution sandbox

- Run build/test commands in disposable containers using a workspace snapshot, with an unprivileged user, dropped capabilities, no new privileges, CPU/memory/PID/time/output limits, and network disabled by default.
- Keep Docker daemon access in the trusted broker. Never mount the Docker socket, host home directory, or cloud credentials into a test container. Docker documents why daemon access is host-level power: [Docker Engine security](https://docs.docker.com/engine/security/).
- If Docker is unavailable, continue chat and read-only analysis; report that verified execution is unavailable rather than pretending the host is sandboxed.

### 4.4 Verification loop and gate

- Detect the relevant npm, Python, Maven, or Gradle checks; run focused tests, then appropriate broader checks. Limit repair attempts and preserve failures in the final report.
- Complete one small change per language fixture. A failed test or unresolved blocking review finding cannot be reported as success. A sandbox escape or resource-limit test must fail safely.

## Phase 5 — Multi-agent coding and durable recovery

**Goal:** turn the working coding loop into the requested MAS without losing control or context.

The CLI exposes the sequential supervisor through `sagent code run`. SQLite stores local checkpoints and approvals. A handoff before editing carries the approved plan to a linked checkout. See [VERIFICATION_BACKLOG.md](VERIFICATION_BACKLOG.md) for external checks.

### 5.1 LangGraph workflows

- Companion mode remains conversational. Coding mode uses a supervisor coordinating Planner, Coder, Tester, and Reviewer. Start with sequential handoffs; parallel work is added only when independent tasks justify it.
- Define typed plan, patch, test-result, review-finding, and completion contracts. The supervisor owns retry limits and the final completion decision.

### 5.2 Agent isolation and memory

- Give each role only its tools, current assignment, approved decisions, and declared predecessor artifacts. The Reviewer can inspect code and evidence without receiving private Coder history.
- Promote only useful, attributable facts to long-term memory. Keep accepted decisions versioned and allow supersession. Add semantic recall of old conversations only after evaluating ordinary search; do not add codebase vector RAG.

### 5.3 Checkpoints and resume

- Use a persistent LangGraph checkpointer locally. Save task ID, graph state, tool-operation IDs, approvals, expected Git revision, and verified outputs. Design external writes to be idempotent so resume does not repeat a push or deployment.
- Sync task metadata and approved summaries. For a second-machine resume, require the matching Git state; if the checkout differs, pause and explain the mismatch. Uncommitted diffs do not sync by default.

### 5.4 Completion gate

- Interrupt during planning, editing, and testing; restart; resume without duplicate effects. Repeat on a second machine at the matching commit.
- Reject a resume with mismatched code, missing approval, or inaccessible private context. Planner/Coder/Tester/Reviewer outputs remain traceable in the CLI.

## Phase 6 — MCP integrations and infrastructure operations

**Goal:** connect external developer systems after local coding is reliable.

### 6.1 MCP broker

- Support pinned local stdio and authenticated remote MCP servers. Discover only enabled tools, validate input schemas, bound output, log calls, and apply SAgent's own tool/approval policy.
- Treat server tool annotations and returned text as hints and untrusted content, never as authorization.

### 6.2 GitHub

- Integrate [GitHub's official MCP server](https://github.com/github/github-mcp-server) with OAuth or narrowly scoped credentials. Start with repository, issue, and PR reads; enable create/update/push operations only for approved workflows.
- Verify issue-to-branch-to-PR flow without exposing credentials to the model or test sandbox.

### 6.3 Docker and Docker Hub

- Add narrow local Docker inspection/build/run tools through an MCP adapter. Keep this operational connection separate from the sandbox runner and require approval for image push, container deletion, and host-affecting actions.
- Add the [Docker Hub MCP server](https://docs.docker.com/docker-hub/mcp-server/) for image discovery and repository operations; use a scoped token for authenticated writes.

### 6.4 Local Kubernetes and Amazon EKS

- Integrate a vetted [local Kubernetes MCP server](https://github.com/containers/kubernetes-mcp-server) using an explicit kubeconfig context and namespace-limited RBAC. Start read-only; require approval for apply, delete, exec, and secret access.
- Add the [AWS Labs EKS MCP server](https://awslabs.github.io/mcp/servers/eks-mcp-server) with explicit AWS profile, account, region, cluster, and IAM/RBAC scope. Keep its write mode disabled by default. AWS's [managed EKS MCP service](https://docs.aws.amazon.com/eks/latest/userguide/eks-mcp-introduction.html) is in preview, so it is an optional later adapter rather than a release dependency.

### 6.5 Completion gate

- Every connector passes read, denied-write, approved-write, wrong-account/context, credential-expiry, and malicious-output tests. The CLI always displays the target repository, image registry, cluster, namespace, and account before an external write.

## Phase 7 — Deployment, installation, and public release

**Goal:** make the system installable, operable, and upgradeable by someone who did not build it.

### 7.1 Hosted API deployment

- Containerize the auth/model/sync API using a production image with a non-root process, health checks, secret injection, and database migrations before traffic. Use Docker Compose with PostgreSQL for local integration tests; deploy the API image and managed PostgreSQL separately in production.
- Keep the hosted API away from users' workspaces and Docker sockets. Add backups, restore drills, logs without secrets, rate limits, and operational alerts.

### 7.2 NPM release artifact

- Publish a scoped CLI package to the public npm registry after reserving its name. Proposed name: `@sagent/cli`; proposed executable: `sagent`. These names are **not yet reserved or published**.
- Remove `private: true` from the CLI package, add a real version and compiled `bin`, and use an explicit package file list. Test `npm pack` and install the packed artifact in clean Windows, macOS, and Linux environments. npm creates the Windows command shim from the package [`bin` entry](https://docs.npmjs.com/files/package.json/).
- Publish only after CI passes and a release is approved; use registry provenance where supported. See [npm package requirements](https://docs.npmjs.com/about-package-json-and-package-lock-json-files/) and [GitHub's npm publishing guide](https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages).

### 7.3 Install commands and onboarding

Once the package name is reserved and published, use these commands with a supported Node.js installation.

**Windows CMD or PowerShell:**

```text
npm install -g @sagent/cli
sagent doctor
sagent login
```

**macOS or Linux shell:**

```sh
npm install -g @sagent/cli
sagent doctor
sagent login
```

- `sagent doctor` checks Node, Git, login/API reachability, local database migration status, Docker availability, and optional MCP prerequisites. It distinguishes required components from optional integrations.
- Document uninstall, update, backup, and rollback. Add a branded `install.ps1` or `install.cmd` only if it solves a real installation problem; do not make users pipe an unaudited remote script into a shell.

### 7.4 Final release gate

- A new user installs from the published package, logs in, chats and syncs on a second machine, completes and resumes a sandboxed coding task, and exercises each MCP connector at its approved permission level.
- Upgrade from the previous release preserves local history and project links. The API can restore from backup. The CLI reports its version and the compatible API range.

## Definition of complete

SAgent is complete when phases 1–7 pass on all supported operating systems, with ordinary chat, four-language coding, durable MAS execution, safe sandboxed tests, cross-machine conversation/task continuity, and the specified GitHub/Docker/Kubernetes/EKS MCP paths. Progress is measured with repeatable repository tasks and security cases, not a claim of parity with another coding agent.

## Deliberate limits for the first public release

- One active coding run per project. No automatic parallel edits to the same checkout.
- No vector database for source code. Conversation embeddings are optional after recall evaluation.
- No automatic production deployment, image push, cluster write, or GitHub publish without a visible target and approval.
- No silent sync of uncommitted source changes or secrets. Git carries source state between machines.
