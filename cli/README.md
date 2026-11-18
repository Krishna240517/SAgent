# SAgent CLI

Node.js 22.13 or newer is required. Build with `npm ci && npm run build`.
The package exposes `sagent`. `sagent --help` works offline.

The CLI uses `~/.sagent/` for its local files. Set `SAGENT_API_URL` to override
the development API URL. The API must be running for login, model responses,
and sync. Existing chats remain readable offline.

```text
sagent login                 Open the browser to approve this CLI
sagent chat                  Continue the latest conversation
sagent chat new              Start a conversation
sagent chat list             Refresh and list conversations
sagent chat open <id>        Continue a specific conversation
sagent chat rename <id> <title>
sagent chat remember <text>  Save an explicitly approved preference
sagent chat preferences      List approved preferences
sagent chat decide <text>    Save a decision
sagent sync                  Push queued changes and pull remote changes
sagent sync conflicts        Inspect divergent records
sagent sync resolve <kind> <id> local|remote
sagent whoami                Validate and show the current account
sagent logout                Revoke the session and remove the local token
sagent project inspect       Show branch, revision, language mix, and changes
sagent project register      Register this checkout's stable project ID
sagent project list          List project IDs on your account
sagent project link <id>     Link another checkout to a registered ID
sagent project sync          Sync coding chats and decisions for this project
sagent repo glob <pattern>   List readable source paths
sagent repo search <regex>   Find bounded source matches with line numbers
sagent repo read <path>      Read source lines (optional --start/--end)
sagent repo map [query]      Show a bounded Tree-sitter symbol map
sagent code ask <question>   Ask a read-only question about this repository
sagent code fix <task>       Preview one model-proposed edit, approve it, and run Docker checks
sagent code actions          List recent edit and verification actions
sagent code action <id>      Show a recorded diff or check failure
sagent code list             List local coding conversations
sagent code decide <text>    Record an approved project decision
```

Chat syncs when it opens and after each prompt. If the API is unreachable,
messages stay in the local outbox and `sagent sync` sends them later. A local
history is bound to one account; use a separate SAgent home for another account.
Only chat messages, decisions, and explicitly saved preferences sync. Source
files and environment values remain local.

Coding search bundles Ripgrep. The CLI also bundles Tree-sitter WASM grammars for
JavaScript, TypeScript, TSX, Python, and Java, so installation needs no C++
compiler. Their licenses are included in `assets/tree-sitter/`. Coding questions
send only selected, bounded source excerpts to the model gateway; files stay in
the checkout. Before resuming work on another machine, run `sagent project
check-revision <sha>` against the expected Git commit.

`code fix` requires an interactive terminal, local Linux Docker, and the relevant
preinstalled test image. It proposes one replacement in an existing source file;
you approve its diff before it changes the checkout. SAgent runs matching focused
tests first, then available repository checks in an isolated copy with no network.
If a check fails, the edit remains visible and the CLI reports failure. Use
`code actions` and `code action <id>` to inspect its record. Ordinary chat and
read-only coding questions still work without Docker. Dependency installation in
the sandbox is not supported yet, so projects needing uncached packages may fail
verification.
