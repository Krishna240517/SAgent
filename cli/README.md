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
```

Chat syncs when it opens and after each prompt. If the API is unreachable,
messages stay in the local outbox and `sagent sync` sends them later. A local
history is bound to one account; use a separate SAgent home for another account.
Only chat messages, decisions, and explicitly saved preferences sync. Source
files and environment values remain local.
